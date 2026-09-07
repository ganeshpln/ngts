/**
 * The Decision Engine (BRD section 28, FR-006, FR-031).
 *
 * The single place a decision is made. Power Automate does not decide, the connector does not
 * decide, and the Copilot Studio agent does not decide - they all consume what this produces.
 *
 * It maps (scenario, programme, sub-intent, confidence band, entities) onto an ordered action plan
 * whose every parameter comes from configuration, then hands that plan to the ActionValidator.
 */

import { validatePlan, type ValidationContext } from '../actions/actionValidator.js';
import { mediumBandPermitsAutomation } from '../classification/confidence.js';
import type { ValidatorVerdict } from '../classification/routingValidator.js';
import { findMissingRequiredEntities } from '../classification/entityValidator.js';
import type {
  ActionPlanItem,
  ActionType,
  Classification,
  ConfidenceAssessment,
  Decision,
  HumanReviewReason,
  MultiIntentResolution,
  NormalisedEmail,
  ProcessingOutcome,
  ProgramResolution,
  SuppressionReason,
} from '../common/types.js';
import type {
  FeatureFlags,
  ResponseTemplateConfig,
  RoutingRuleConfig,
  SafetyConfig,
  ScenarioConfig,
  ThresholdConfig,
} from '../configuration/types.js';
import { renderTemplate, resolveTemplate } from '../templates/templateResolver.js';
import { resolveRouting, type RoutingResolution } from './routingResolver.js';

export interface DecisionInput {
  readonly processingId: string;
  readonly email: NormalisedEmail;
  readonly classification: Classification;
  readonly scenario: ScenarioConfig;
  readonly scenarios: readonly ScenarioConfig[];
  readonly programResolution: ProgramResolution;
  readonly multiIntentResolution: MultiIntentResolution;
  readonly confidence: ConfidenceAssessment;
  readonly routingRules: readonly RoutingRuleConfig[];
  readonly templates: readonly ResponseTemplateConfig[];
  readonly thresholds: ThresholdConfig;
  readonly flags: FeatureFlags;
  readonly safety: SafetyConfig;
  readonly regionCode: string;
  readonly suppressionReason: SuppressionReason | null;
  /** Result of the routing_decision_validator prompt, where it was called. */
  /**
   * The routing_decision_validator's second opinion (prompt 5), or null when it was not consulted.
   * Disagreement demotes to human review; agreement never promotes past a gate already failed.
   */
  readonly validatorVerdict: ValidatorVerdict | null;
}

function escalation(
  input: DecisionInput,
  reason: HumanReviewReason,
  warnings: readonly string[],
): Decision {
  return {
    processingId: input.processingId,
    outcome: 'HUMAN_REVIEW',
    classification: input.classification,
    programResolution: input.programResolution,
    multiIntentResolution: input.multiIntentResolution,
    confidence: input.confidence,
    // No mailbox side effect on the escalation path - the message is left exactly as it arrived
    // (NFR-002).
    actionPlan: [
      {
        sequence: 1,
        actionType: 'EscalateToHumanReview',
        parameters: { humanReviewReason: reason },
        resolvedDestination: null,
        scenarioId: input.scenario.scenarioId,
      },
    ],
    humanReviewReason: reason,
    suppressionReason: null,
    regionCode: input.regionCode,
    warnings,
  };
}

/** Human-review triggers evaluated before any plan is built (BRD section 10, FR-060). */
function preflightHumanReview(input: DecisionInput): { reason: HumanReviewReason; warning: string } | null {
  const { classification, scenario, confidence, multiIntentResolution, programResolution } = input;

  if (scenario.scenarioId === 'SC-99') {
    return { reason: 'HIL-07', warning: 'Email could not be matched to any of the twelve business scenarios.' };
  }
  if (classification.injectionSuspected === true) {
    return { reason: 'HIL-09', warning: 'Content resembling a prompt-injection attempt was detected.' };
  }
  // The second opinion disagrees. This demotes at ANY band - a HIGH-confidence classification the
  // validator reads differently is exactly the case worth a human's minute (docs/ai-agent-design.md
  // section 3). Agreement, by contrast, never promotes anything.
  if (input.validatorVerdict && !input.validatorVerdict.agrees) {
    const concern = input.validatorVerdict.concern ?? 'no reason given';
    const suggestion = input.validatorVerdict.suggestedScenarioId
      ? ` It suggested ${input.validatorVerdict.suggestedScenarioId}, which is advisory only.`
      : '';
    return {
      reason: 'HIL-02',
      warning: `The routing validator disagreed with the proposed decision: ${concern}${suggestion}`,
    };
  }
  if (classification.requiresHumanReview) {
    return { reason: 'HIL-01', warning: 'The classifier itself requested human review.' };
  }
  if (confidence.band === 'LOW') {
    return { reason: 'HIL-01', warning: `Effective confidence ${confidence.effectiveConfidence.toFixed(2)} is below the low threshold.` };
  }
  if (multiIntentResolution.requiresHumanReview) {
    return { reason: 'HIL-02', warning: multiIntentResolution.reason ?? 'Conflicting intents could not be reconciled.' };
  }
  if (
    confidence.band === 'MEDIUM' &&
    !mediumBandPermitsAutomation(
      confidence,
      multiIntentResolution.multiIntent,
      input.validatorVerdict?.agrees ?? null,
      input.thresholds,
    )
  ) {
    return { reason: 'HIL-01', warning: 'Medium-confidence classification was not corroborated by the deterministic check.' };
  }
  // Multi-intent needs the second opinion at ANY band, not just medium. Two genuine intents can
  // involve two different teams, and no deterministic signal tells you which the sender primarily
  // needs - so high confidence in the PRIMARY label is not confidence that acting on it alone is
  // right. An unreachable validator therefore means a human, never an assumed agreement.
  if (
    multiIntentResolution.multiIntent &&
    input.thresholds.corroboration.requireValidatorAgreementForMultiIntent &&
    input.validatorVerdict?.agrees !== true
  ) {
    return {
      reason: 'HIL-02',
      warning: input.validatorVerdict
        ? 'The routing validator did not agree the multi-intent decision.'
        : 'Multi-intent email with no second opinion available; the routing validator was not consulted or could not be reached.',
    };
  }

  // HIL-03: the scenario cannot proceed without a programme and the evidence did not establish one.
  // Note this fires ONLY when the scenario declares requiresProgram - for most FIT/FLO scenarios the
  // BRD's own fallback (route to both owners) is the answer, and escalating would override it.
  if (scenario.requiresProgram && programResolution.program === 'UNKNOWN' && programResolution.conflicting) {
    return { reason: 'HIL-03', warning: 'The email refers to both FIT and FLO; the programme cannot be determined.' };
  }
  const missing = findMissingRequiredEntities(scenario.scenarioId, classification.extractedEntities);
  if (missing.length > 0) {
    return { reason: 'HIL-06', warning: `Required information is missing: ${missing.join(', ')}.` };
  }

  return null;
}

/**
 * BRD section 6 Scenarios 1 and 2: the troubleshooting template is the FIRST contact, and the
 * programme owner is involved only when the issue persists or the sender supplies a screenshot or
 * GPID. Forwarding every first-contact email to the owner would defeat the point of the
 * troubleshooting response.
 *
 * REQUIREMENT GAP GAP-010 / Q-09: the BRD gives no detection rule or waiting period for "the issue
 * persists", so the rule ships DISABLED and only the two objectively detectable triggers
 * (screenshot attached, GPID supplied) are implemented.
 */
export function shouldEscalateToOwner(scenario: ScenarioConfig, input: DecisionInput): boolean {
  const rule = scenario.escalationRule;
  if (!rule?.enabled || rule.escalateTo !== 'PROGRAM_OWNER') return false;

  const triggers = new Set(rule.escalateWhen);
  if (triggers.has('gpidProvided') && input.classification.extractedEntities.gpid) return true;
  if (triggers.has('screenshotAttached') && input.email.attachments.some((a) => a.isScreenshot)) return true;
  // 'senderConfirmsIssuePersists' is deliberately not implemented - see GAP-010.
  return false;
}

function buildPlanForRule(
  input: DecisionInput,
  scenario: ScenarioConfig,
  routing: RoutingResolution,
  startSequence: number,
  warnings: string[],
): ActionPlanItem[] {
  const plan: ActionPlanItem[] = [];
  const actions = (routing.rule?.actionPlan ?? []) as readonly ActionType[];
  let sequence = startSequence;

  for (const actionType of actions) {
    switch (actionType) {
      case 'SendResponse': {
        const templateResult = resolveTemplate(input.templates, {
          scenarioId: scenario.scenarioId,
          program: input.programResolution.program,
          senderType: input.classification.senderType,
          proposedTemplateId: routing.responseTemplateId ?? input.classification.responseTemplateId,
        });
        if (!templateResult.ok) {
          // Expected while GAP-004 is open. The step is omitted and the reason recorded; the item
          // still reaches the human review queue because the plan is then incomplete.
          warnings.push(`SendResponse omitted: ${templateResult.error.detail ?? templateResult.error.kind}`);
          break;
        }
        // The renderer rejects any variable the template does not declare (BRD section 16), so the
        // caller offers the available values and lets the template's own allow-list select from them.
        const available: Record<string, string | null> = {
          originalSubject: input.email.subject,
          senderFirstName: input.email.senderName.split(' ')[0] ?? null,
          learnerName: input.classification.extractedEntities.learnerName,
          program: input.programResolution.program,
          newEmail: input.classification.extractedEntities.email,
          ownerName: routing.ownerName,
        };
        const values: Record<string, string | null> = {};
        for (const name of templateResult.value.allowedVariables) {
          if (name in available) values[name] = available[name] ?? null;
        }

        const rendered = renderTemplate(templateResult.value, values);
        if (!rendered.ok) {
          warnings.push(`SendResponse omitted: template render rejected (${rendered.error.kind}).`);
          break;
        }
        plan.push({
          sequence: sequence++,
          actionType: 'SendResponse',
          parameters: {
            templateId: rendered.value.templateId,
            subject: rendered.value.subject,
            body: rendered.value.body,
            toRecipients: [input.email.senderEmail],
          },
          resolvedDestination: input.email.senderEmail,
          scenarioId: scenario.scenarioId,
        });
        break;
      }

      case 'RouteToProgramOwner':
      case 'ForwardEmail': {
        if (routing.recipients.length === 0) {
          warnings.push(`${actionType} omitted: no configured owner address (HIL-04).`);
          break;
        }
        plan.push({
          sequence: sequence++,
          actionType,
          parameters: { toRecipients: routing.recipients },
          resolvedDestination: routing.recipients.join('; '),
          scenarioId: scenario.scenarioId,
        });
        break;
      }

      case 'RouteToChangeRequest': {
        plan.push({
          sequence: sequence++,
          actionType: 'RouteToChangeRequest',
          parameters: { toRecipients: routing.recipients },
          resolvedDestination: routing.recipients.join('; ') || null,
          scenarioId: scenario.scenarioId,
        });
        break;
      }

      case 'MoveEmail': {
        if (!routing.destinationFolder) {
          // GAP-005 - the BRD names only three folders. Rather than invent one, no move happens and
          // the omission is recorded against the audit row.
          warnings.push(`MoveEmail omitted: no destination folder configured for ${scenario.scenarioId} (GAP-005).`);
          break;
        }
        plan.push({
          sequence: sequence++,
          actionType: 'MoveEmail',
          parameters: { destinationFolder: routing.destinationFolder },
          resolvedDestination: routing.destinationFolder,
          scenarioId: scenario.scenarioId,
        });
        break;
      }

      case 'MarkAsRead': {
        plan.push({
          sequence: sequence++,
          actionType: 'MarkAsRead',
          parameters: {},
          resolvedDestination: null,
          scenarioId: scenario.scenarioId,
        });
        break;
      }

      case 'DeleteEmail': {
        plan.push({
          sequence: sequence++,
          actionType: 'DeleteEmail',
          // Soft delete by default (GAP-006): a move to Deleted Items is reversible.
          parameters: { hardDelete: input.safety.hardDeleteEnabled },
          resolvedDestination: input.safety.hardDeleteEnabled ? 'permanent' : 'deleteditems',
          scenarioId: scenario.scenarioId,
        });
        break;
      }

      case 'EscalateToHumanReview': {
        plan.push({
          sequence: sequence++,
          actionType: 'EscalateToHumanReview',
          parameters: { humanReviewReason: 'HIL-07' },
          resolvedDestination: null,
          scenarioId: scenario.scenarioId,
        });
        break;
      }

      default:
        warnings.push(`Action "${actionType}" in rule ${routing.rule?.ruleId} is not executable here and was skipped.`);
    }
  }

  return plan;
}

/**
 * Ordering rule: mutating steps first, then the move, then mark-as-read.
 *
 * A move changes the Graph message id, so nothing that needs the original id may follow it.
 */
function orderPlan(plan: readonly ActionPlanItem[]): ActionPlanItem[] {
  const rank: Readonly<Record<ActionType, number>> = {
    SendResponse: 10,
    RouteToChangeRequest: 20,
    RouteToProgramOwner: 30,
    ForwardEmail: 30,
    EscalateToHumanReview: 40,
    MoveEmail: 80,
    DeleteEmail: 85,
    MarkAsRead: 90,
    GenerateReport: 99,
  };
  return [...plan]
    .sort((a, b) => rank[a.actionType] - rank[b.actionType] || a.sequence - b.sequence)
    .map((item, index) => ({ ...item, sequence: index + 1 }));
}

export function decide(input: DecisionInput): Decision {
  const warnings: string[] = [];

  // Suppression short-circuits everything: an owner has replied, the message is our own, or a loop
  // guard fired. The message is marked read for tidiness and nothing else happens.
  if (input.suppressionReason) {
    const markAsReadOnly: ActionPlanItem[] = input.flags.markAsReadEnabled
      ? [{ sequence: 1, actionType: 'MarkAsRead', parameters: {}, resolvedDestination: null, scenarioId: input.scenario.scenarioId }]
      : [];
    return {
      processingId: input.processingId,
      outcome: 'SUPPRESS',
      classification: input.classification,
      programResolution: input.programResolution,
      multiIntentResolution: input.multiIntentResolution,
      confidence: input.confidence,
      actionPlan: markAsReadOnly,
      humanReviewReason: null,
      suppressionReason: input.suppressionReason,
      regionCode: input.regionCode,
      warnings: [`Processing suppressed: ${input.suppressionReason}.`],
    };
  }

  const preflight = preflightHumanReview(input);
  if (preflight) return escalation(input, preflight.reason, [preflight.warning]);

  const primaryRouting = resolveRouting(input.routingRules, {
    scenarioId: input.scenario.scenarioId,
    program: input.programResolution.program,
    subIntent: input.classification.subIntent ?? null,
  });

  if (!primaryRouting.resolved) {
    return escalation(input, 'HIL-04', [primaryRouting.failureReason ?? 'Routing could not be resolved.']);
  }
  if (primaryRouting.failureReason) warnings.push(primaryRouting.failureReason);

  let plan = buildPlanForRule(input, input.scenario, primaryRouting, 1, warnings);

  // MI-SCHOOX-PLUS (BRD section 6 Scenario 7, Rule R-2): a Schoox email carrying a SEPARATE FIT/FLO
  // issue is routed to the FIT/FLO owner as well. Both routes execute; the folder stays Schoox.
  const configuredRecipients = new Set<string>(primaryRouting.recipients);
  if (input.multiIntentResolution.ruleApplied === 'MI-SCHOOX-PLUS') {
    for (const additionalScenarioId of input.multiIntentResolution.additionalScenarioIds) {
      const additionalScenario = input.scenarios.find((s) => s.scenarioId === additionalScenarioId);
      if (!additionalScenario) continue;

      // The primary programme is MEC_CGR (Schoox), which says nothing about the FIT/FLO issue
      // riding along with it. Resolving the secondary route as UNKNOWN lets the BRD's own fallback
      // (Rule R-1, both owners) apply rather than guessing FIT or FLO.
      const secondaryProgram =
        additionalScenario.programScope === 'FIT_FLO' &&
        input.programResolution.program !== 'FIT' &&
        input.programResolution.program !== 'FLO'
          ? 'UNKNOWN'
          : input.programResolution.program;

      const secondaryRouting = resolveRouting(input.routingRules, {
        scenarioId: additionalScenarioId,
        program: secondaryProgram,
        subIntent: null,
      });
      if (!secondaryRouting.resolved || secondaryRouting.recipients.length === 0) {
        warnings.push(`Secondary route for ${additionalScenarioId} could not be resolved; it was not added.`);
        continue;
      }
      for (const r of secondaryRouting.recipients) configuredRecipients.add(r);
      plan.push({
        sequence: plan.length + 1,
        actionType: 'RouteToProgramOwner',
        parameters: { toRecipients: secondaryRouting.recipients },
        resolvedDestination: secondaryRouting.recipients.join('; '),
        scenarioId: additionalScenarioId,
      });
      warnings.push(`Multi-intent: also routed to the ${additionalScenarioId} owner (Rule R-2).`);
    }
  }

  if (shouldEscalateToOwner(input.scenario, input) && primaryRouting.recipients.length > 0) {
    if (!plan.some((item) => item.actionType === 'RouteToProgramOwner')) {
      plan.push({
        sequence: plan.length + 1,
        actionType: 'RouteToProgramOwner',
        parameters: { toRecipients: primaryRouting.recipients },
        resolvedDestination: primaryRouting.recipients.join('; '),
        scenarioId: input.scenario.scenarioId,
      });
      warnings.push('Escalation criteria met; the message was also routed to the programme owner.');
    }
  }

  plan = orderPlan(plan);

  const validationContext: ValidationContext = {
    scenario: input.scenario,
    flags: input.flags,
    safety: input.safety,
    thresholds: input.thresholds,
    band: input.confidence.band,
    // The sender is a legal recipient only for a reply to that sender.
    configuredRecipients: [...configuredRecipients, input.email.senderEmail],
    configuredFolders: input.routingRules
      .map((r) => r.destinationFolder)
      .filter((f): f is string => typeof f === 'string' && f.length > 0),
    templates: input.templates,
  };

  const validation = validatePlan(plan, validationContext);

  if (validation.rejected.length > 0) {
    const reasons = validation.rejected.map((r) => `${r.verdict.code}: ${r.verdict.reason}`);
    return escalation(input, 'HIL-09', [...warnings, ...reasons]);
  }

  // A plan that has been reduced to housekeeping only - typically MarkAsRead, because the reply and
  // the move were both omitted for want of configuration - would silently mark the email read and
  // leave nobody acting on it. That is worse than escalating, so it escalates.
  const SUBSTANTIVE: readonly ActionType[] = [
    'SendResponse', 'ForwardEmail', 'RouteToProgramOwner', 'RouteToChangeRequest', 'MoveEmail', 'DeleteEmail',
  ];
  const plannedSubstantive = (routing: readonly ActionType[]) => routing.some((a) => SUBSTANTIVE.includes(a));
  const intendedSubstantive = plannedSubstantive((primaryRouting.rule?.actionPlan ?? []) as readonly ActionType[]);
  const actualSubstantive = validation.approved.some((item) => SUBSTANTIVE.includes(item.actionType));

  if (intendedSubstantive && !actualSubstantive) {
    return escalation(input, 'HIL-04', [
      ...warnings,
      'Every substantive action was omitted; only housekeeping remained, so the email needs a human.',
    ]);
  }

  if (validation.approved.length === 0) {
    // Everything was omitted upstream - typically because templates are inactive and folders are
    // unconfigured. A human handles it rather than the email being silently left unprocessed.
    return escalation(input, 'HIL-04', [...warnings, 'No executable action remained after resolution.']);
  }

  const outcome: ProcessingOutcome = input.flags.shadowMode ? 'SHADOW' : 'EXECUTE';

  return {
    processingId: input.processingId,
    outcome,
    classification: input.classification,
    programResolution: input.programResolution,
    multiIntentResolution: input.multiIntentResolution,
    confidence: input.confidence,
    actionPlan: validation.approved,
    humanReviewReason: null,
    suppressionReason: null,
    regionCode: input.regionCode,
    warnings,
  };
}
