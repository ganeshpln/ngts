/**
 * The pipeline and composition root (docs/component-design.md section 10).
 *
 *   claim -> guard -> normalise -> attachments -> classify -> validate schema
 *         -> entities / programme / multi-intent -> band -> corroborate -> decide -> execute -> audit
 *
 * Each stage can end the run. The orchestrator owns that control flow so no individual module has
 * to know what "stop here" means for the mailbox.
 */

import { AttachmentProcessor } from '../attachments/attachmentProcessor.js';
import { assessConfidence } from '../classification/confidence.js';
import { corroborate } from '../classification/corroborator.js';
import { validateEntities } from '../classification/entityValidator.js';
import { resolveMultiIntent } from '../classification/multiIntentResolver.js';
import { resolveProgram } from '../classification/programResolver.js';
import {
  buildClassifierUserMessage,
  buildScenarioCatalogue,
  PromptLoader,
  renderSystemPrompt,
  senderDomainType,
} from '../classification/promptBuilder.js';
import { extractJsonObject, validateClassification } from '../classification/schemaValidator.js';
import type { ModelClient } from '../classification/modelClient.js';
import { newProcessingId } from '../common/hash.js';
import type { Logger } from '../common/logger.js';
import { hashIdentifier } from '../common/redact.js';
import type {
  Classification,
  Decision,
  NormalisedEmail,
  RawEmail,
  SubIntent,
  SuppressionReason,
  ThreadMessage,
} from '../common/types.js';
import type { ConfigurationStore, ScenarioConfig } from '../configuration/types.js';
import { detectAutoReply } from '../email/autoReplyDetector.js';
import { claimForProcessing, type ProcessingStore } from '../email/idempotency.js';
import { scanForInjection } from '../email/injectionDetector.js';
import { checkLoop } from '../email/loopPrevention.js';
import { normaliseEmail } from '../email/normalizer.js';
import { checkOwnerResponded } from '../email/ownerResponseDetector.js';
import { resolveSenderType } from '../email/senderClassifier.js';
import { resolveRegion } from '../reporting/regionResolver.js';
import { decide } from '../routing/decisionEngine.js';

export interface OrchestratorDependencies {
  readonly config: ConfigurationStore;
  readonly model: ModelClient;
  readonly processingStore: ProcessingStore;
  readonly promptLoader: PromptLoader;
  readonly logger: Logger;
  readonly mailboxAddress: string | null;
  readonly now?: () => Date;
}

export interface ProcessRequest {
  readonly correlationId: string;
  readonly message: RawEmail;
  readonly threadContext?: readonly ThreadMessage[];
}

export interface ProcessResponse {
  readonly processingId: string;
  readonly decision: Decision;
  readonly normalisedEmail: NormalisedEmail | null;
  readonly classificationLatencyMs: number | null;
  readonly promptVersion: string | null;
}

const SC99: ScenarioConfig = {
  scenarioId: 'SC-99',
  scenarioName: 'Unknown / unclassifiable',
  brdReference: 'AD-001',
  intent: 'unknown',
  description: '',
  keywords: [],
  positiveExamples: [],
  negativeExamples: [],
  programScope: 'ANY',
  requiresProgram: false,
  allowedActions: ['EscalateToHumanReview'],
  sendResponseAllowed: false,
  deleteAllowed: false,
  precedence: 0,
  subIntents: [],
  escalationRule: { enabled: true, escalateWhen: ['always'], escalateTo: 'HUMAN_REVIEW', waitHours: null },
  isActive: true,
};

/** A minimal classification used when the model could not produce a usable one (HIL-05). */
function unknownClassification(reason: string): Classification {
  return {
    scenarioId: 'SC-99',
    scenarioName: 'Unknown / unclassifiable',
    program: 'UNKNOWN',
    intent: 'unknown',
    subIntent: null,
    confidence: 0,
    senderType: 'unknown',
    requiresHumanReview: true,
    multiIntent: false,
    secondaryIntents: [],
    extractedEntities: {
      learnerName: null, gpid: null, email: null, program: null, island: null, week: null, errorMessage: null,
    },
    missingRequiredInformation: [],
    recommendedAction: 'EscalateToHumanReview',
    routingOwner: null,
    routingEmail: null,
    destinationFolder: null,
    responseTemplateId: null,
    reasoningSummary: reason,
    injectionSuspected: false,
    languageDetected: null,
  };
}

export class Orchestrator {
  private readonly now: () => Date;

  constructor(private readonly deps: OrchestratorDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async process(request: ProcessRequest): Promise<ProcessResponse> {
    const { config, logger } = this.deps;
    const processingId = newProcessingId();
    const log = logger.child({
      correlationId: request.correlationId,
      processingId,
      messageIdHash: hashIdentifier(request.message.internetMessageId ?? request.message.id),
    });

    const [scenarios, routingRules, templates, thresholds, flags, safety, attachmentConfig, senderTypes, regions, reporting, aiConfig, multiIntentConfig] =
      await Promise.all([
        config.getScenarios(),
        config.getRoutingRules(),
        config.getTemplates(),
        config.getThresholds(),
        config.getFeatureFlags(),
        config.getSafetyConfig(),
        config.getAttachmentConfig(),
        config.getSenderTypeConfig(),
        config.getRegionMappings(),
        config.getReportingConfig(),
        config.getAiConfig(),
        config.getMultiIntentConfig(),
      ]);

    // --- Attachments and normalisation ------------------------------------
    const attachmentProcessor = new AttachmentProcessor(attachmentConfig, flags.attachmentContentHandlers);
    const { metadata, summary } = attachmentProcessor.process(request.message.attachments ?? []);

    const email = normaliseEmail(request.message, metadata, request.threadContext ?? [], {
      maxBodyChars: safety.maxBodyChars,
      maxSubjectChars: safety.maxSubjectChars,
    });

    // --- Idempotency: claim BEFORE any side effect (FR-070) ---------------
    const claim = await claimForProcessing(this.deps.processingStore, email, processingId, this.now());
    if (claim.kind === 'duplicate') {
      log.info('Duplicate message; processing stopped', { stage: 'Guard', outcome: 'DUPLICATE' });
      return {
        processingId,
        decision: this.terminal(processingId, 'DUPLICATE', null, reporting.unmappedRegionCode, [
          `Already processed as ${claim.existing.processingId} (matched on ${claim.matchedOn}).`,
        ]),
        normalisedEmail: email,
        classificationLatencyMs: null,
        promptVersion: null,
      };
    }

    // --- Guards: loop prevention and owner suppression ---------------------
    const outboundCount = await this.deps.processingStore.countOutboundForConversation(email.conversationId);
    const loopVerdict = checkLoop(email, safety, {
      outboundCountForConversation: outboundCount,
      mailboxAddress: this.deps.mailboxAddress,
    });
    const ownerVerdict = checkOwnerResponded(safety, flags.ownerResponseSuppressionEnabled, {
      threadContext: email.threadContext,
      now: this.now(),
    });
    const suppression: SuppressionReason | null = loopVerdict.blocked
      ? loopVerdict.reason
      : ownerVerdict.blocked
        ? ownerVerdict.reason
        : null;

    // --- Classification ----------------------------------------------------
    const injection = scanForInjection(email.subject, email.body);
    const autoReply = detectAutoReply(email.headers, email.subject, email.body);

    let classification: Classification;
    let latencyMs: number | null = null;
    let promptVersion: string | null = null;

    if (suppression) {
      // A suppressed message is not sent to the model at all: no value in classifying something
      // that cannot be acted on, and it avoids the cost and the data exposure.
      classification = unknownClassification('Processing suppressed before classification.');
    } else {
      const classifyResult = await this.classify(email, summary.promptSummary, scenarios, senderTypes.internalDomains, aiConfig);
      classification = classifyResult.classification;
      latencyMs = classifyResult.latencyMs;
      promptVersion = classifyResult.promptVersion;
      log.info('Classification completed', {
        stage: 'Classify',
        scenarioId: classification.scenarioId,
        confidence: classification.confidence,
        aiLatencyMs: latencyMs ?? undefined,
        promptVersion: promptVersion ?? undefined,
        aiStatus: classifyResult.ok ? 'ok' : 'invalid',
      });
    }

    // Deterministic corrections applied on top of the model's output.
    const senderResolution = resolveSenderType(classification.senderType, email.senderDomain, senderTypes);
    const injectionSuspected = classification.injectionSuspected === true || injection.suspected;
    classification = { ...classification, senderType: senderResolution.senderType, injectionSuspected };

    const scenario = scenarios.find((s) => s.scenarioId === classification.scenarioId) ?? SC99;

    // --- Multi-intent, programme, confidence -------------------------------
    const subIntents = new Map<string, SubIntent>([[classification.scenarioId, classification.subIntent ?? null]]);
    for (const secondary of classification.secondaryIntents ?? []) {
      subIntents.set(secondary.scenarioId, secondary.subIntent ?? null);
    }

    const multiIntentResolution = resolveMultiIntent({
      classification,
      scenarios,
      config: multiIntentConfig,
      machineGenerated: autoReply.definitive || classification.senderType === 'system',
      subIntents,
    });

    // The multi-intent resolver may promote a different scenario to primary.
    const effectiveScenario =
      multiIntentResolution.primaryScenarioId === scenario.scenarioId
        ? scenario
        : (scenarios.find((s) => s.scenarioId === multiIntentResolution.primaryScenarioId) ?? scenario);

    const effectiveClassification: Classification = {
      ...classification,
      scenarioId: effectiveScenario.scenarioId,
      scenarioName: effectiveScenario.scenarioName,
      subIntent: subIntents.get(effectiveScenario.scenarioId) ?? classification.subIntent ?? null,
      multiIntent: multiIntentResolution.multiIntent,
    };

    const programResolution = resolveProgram(effectiveClassification, effectiveScenario, thresholds);
    const entityValidation = validateEntities(effectiveClassification.extractedEntities);
    const corroboration = corroborate(email, effectiveScenario, scenarios, thresholds.corroboration.minimumSignalMatches);

    const confidence = assessConfidence(
      {
        rawConfidence: effectiveClassification.confidence,
        scenarioId: effectiveScenario.scenarioId,
        bodyLength: email.body.length,
        injectionSuspected,
        languageDetected: effectiveClassification.languageDetected ?? null,
        hasInvalidEntities: !entityValidation.valid,
        corroborated: corroboration.corroborated,
        corroboratingSignals: corroboration.matchedSignals,
      },
      thresholds,
      effectiveScenario,
    );

    const region = resolveRegion(regions, reporting, { email });

    // --- Decision ----------------------------------------------------------
    const decision = decide({
      processingId,
      email,
      classification: effectiveClassification,
      scenario: effectiveScenario,
      scenarios,
      programResolution,
      multiIntentResolution,
      confidence,
      routingRules,
      templates,
      thresholds,
      flags,
      safety,
      regionCode: region.regionCode,
      suppressionReason: suppression,
      // The routing_decision_validator is a separate model call wired at the API layer; when it has
      // not been consulted, medium-band multi-intent items fail the corroboration gate and go to a
      // human, which is the safe default.
      validatorAgrees: null,
    });

    log.info('Decision produced', {
      stage: 'Decide',
      scenarioId: decision.classification.scenarioId,
      program: decision.programResolution.program,
      confidence: decision.confidence.effectiveConfidence,
      confidenceBand: decision.confidence.band,
      outcome: decision.outcome,
      humanReviewReason: decision.humanReviewReason ?? undefined,
      selectedAction: decision.actionPlan.map((a) => a.actionType).join(','),
    });

    return { processingId, decision, normalisedEmail: email, classificationLatencyMs: latencyMs, promptVersion };
  }

  private async classify(
    email: NormalisedEmail,
    attachmentSummary: string,
    scenarios: readonly ScenarioConfig[],
    internalDomains: readonly string[],
    aiConfig: { temperature: number; maxTokens: number; prompts: Readonly<Record<string, { file: string; version: string }>> },
  ): Promise<{ ok: boolean; classification: Classification; latencyMs: number | null; promptVersion: string | null }> {
    const promptRef = aiConfig.prompts.emailIntentClassifier;
    const promptFileName = (promptRef?.file ?? 'prompts/email-classifier.md').replace(/^prompts\//, '');
    const prompt = await this.deps.promptLoader.load(promptFileName);

    const systemPrompt = renderSystemPrompt(prompt, {
      SCENARIO_CATALOGUE: buildScenarioCatalogue(scenarios),
    });
    const userMessage = buildClassifierUserMessage({
      email,
      attachmentSummary,
      senderDomainType: senderDomainType(email, internalDomains),
    });

    const response = await this.deps.model.complete({
      systemPrompt,
      userMessage,
      promptName: prompt.name,
      promptVersion: prompt.version,
      maxTokens: aiConfig.maxTokens,
      temperature: aiConfig.temperature,
    });

    if (!response.ok) {
      return {
        ok: false,
        classification: unknownClassification(`Classification call failed: ${response.error.code}.`),
        latencyMs: null,
        promptVersion: prompt.version,
      };
    }

    const parsed = extractJsonObject(response.value.content);
    const validated = validateClassification(parsed);

    if (!validated.ok) {
      // AD-020: one repair attempt happens at the API layer, which can re-prompt with the
      // violations. Reaching here means the output is still unusable, so HIL-05 applies.
      return {
        ok: false,
        classification: unknownClassification('Classifier returned output that did not match the required schema.'),
        latencyMs: response.value.latencyMs,
        promptVersion: prompt.version,
      };
    }

    return {
      ok: true,
      classification: validated.value,
      latencyMs: response.value.latencyMs,
      promptVersion: prompt.version,
    };
  }

  private terminal(
    processingId: string,
    outcome: Decision['outcome'],
    suppressionReason: SuppressionReason | null,
    regionCode: string,
    warnings: readonly string[],
  ): Decision {
    const classification = unknownClassification('Terminated before classification.');
    return {
      processingId,
      outcome,
      classification,
      programResolution: { program: 'UNKNOWN', score: 0, resolvedBy: 'fallback', appliedFallbackRule: false, conflicting: false },
      multiIntentResolution: {
        multiIntent: false,
        primaryScenarioId: 'SC-99',
        additionalScenarioIds: [],
        ruleApplied: null,
        requiresHumanReview: false,
        reason: null,
      },
      confidence: {
        rawConfidence: 0,
        effectiveConfidence: 0,
        band: 'LOW',
        penaltiesApplied: [],
        corroborated: false,
        corroboratingSignals: [],
      },
      actionPlan: [],
      humanReviewReason: null,
      suppressionReason,
      regionCode,
      warnings,
    };
  }
}
