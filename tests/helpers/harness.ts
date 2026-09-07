/**
 * Scenario-test harness.
 *
 * Builds the REAL pipeline - real configuration, real decision engine, real validator - with the
 * model and the mailbox replaced by doubles. That is what makes these tests evidence about the
 * system rather than about the mocks.
 */

import { ActionExecutor } from '../../src/actions/actionExecutor.js';
import { ScriptedModelClient } from '../../src/classification/modelClient.js';
import { PromptLoader } from '../../src/classification/promptBuilder.js';
import { NullLogger } from '../../src/common/logger.js';
import type { Classification, Decision, RawEmail, ThreadMessage } from '../../src/common/types.js';
import { JsonConfigurationStore } from '../../src/configuration/jsonConfigurationStore.js';
import { Orchestrator } from '../../src/agent/orchestrator.js';
import {
  InMemoryProcessingStore,
  RecordingAudit,
  RecordingHumanReview,
  RecordingMailbox,
  makeClassification,
} from './fixtures.js';

export const MAILBOX_ADDRESS = 'spa@pepsico.com';
export const JORDAN = 'jordan.beahrs@pepsico.com';
export const JOSH = 'josh.baxter@pepsico.com';
export const AMY = 'amy.fischer@pepsico.com';

export interface HarnessOptions {
  /** Feature flags to switch on for this test (everything ships off). */
  readonly enable?: readonly string[];
  /** Feature flags to switch off. */
  readonly disable?: readonly string[];
  /** Activate a response template by id, simulating Business supplying approved wording. */
  readonly activateTemplates?: readonly string[];
  readonly safety?: Record<string, unknown>;
  /** Enable the escalation rule for these scenarios (it ships disabled - GAP-010). */
  readonly enableEscalation?: readonly string[];
  /** Supply a change-request destination, simulating the answer to Q-04 (GAP-003). */
  readonly changeRequestAddress?: string;
  readonly outboundCounts?: Readonly<Record<string, number>>;
  /**
   * Scripted routing_decision_validator response. Omit it to simulate the validator being
   * unreachable, which is the fail-safe path (no agreement, so medium-band multi-intent escalates).
   * Pass a raw string to simulate a malformed response.
   */
  readonly routingValidation?: Record<string, unknown> | string;
  readonly now?: Date;
}

export interface HarnessResult {
  readonly decision: Decision;
  /** The scripted model client, so tests can assert WHICH prompts were called. */
  readonly model: ScriptedModelClient;
  readonly mailbox: RecordingMailbox;
  readonly humanReview: RecordingHumanReview;
  readonly audit: RecordingAudit;
  readonly store: InMemoryProcessingStore;
  readonly processingId: string;
}

export async function buildConfig(options: HarnessOptions = {}): Promise<JsonConfigurationStore> {
  const config = new JsonConfigurationStore();

  await config.override('application.json', (doc) => {
    for (const flag of options.enable ?? []) {
      if (doc.features[flag]) doc.features[flag].value = true;
    }
    for (const flag of options.disable ?? []) {
      if (doc.features[flag]) doc.features[flag].value = false;
    }
    Object.assign(doc.safety, options.safety ?? {});
  });

  if (options.activateTemplates?.length) {
    await config.override('response-templates.json', (doc) => {
      for (const template of doc.templates) {
        if (options.activateTemplates!.includes(template.templateId)) {
          template.isActive = true;
          template.bodyTemplate = 'Hello {{senderFirstName}}, we have received your message about {{originalSubject}}.';
          template.approvedBy = 'Test Business Owner';
        }
      }
    });
  }

  if (options.enableEscalation?.length) {
    await config.override('scenarios.json', (doc) => {
      for (const scenario of doc.scenarios) {
        if (options.enableEscalation!.includes(scenario.scenarioId)) {
          scenario.escalationRule.enabled = true;
          scenario.escalationRule.escalateTo = 'PROGRAM_OWNER';
        }
      }
    });
  }

  if (options.changeRequestAddress) {
    await config.override('routing-rules.json', (doc) => {
      for (const rule of doc.routingRules) {
        if (rule.routingTarget === 'CHANGE_REQUEST') {
          rule.ownerEmails = [options.changeRequestAddress];
        }
      }
    });
  }

  return config;
}

/**
 * Run one email through the pipeline with a scripted classification, then execute the resulting
 * plan through the recording mailbox.
 */
export async function run(
  email: RawEmail,
  classification: Partial<Classification>,
  options: HarnessOptions = {},
  threadContext: readonly ThreadMessage[] = [],
): Promise<HarnessResult> {
  const config = await buildConfig(options);
  const store = new InMemoryProcessingStore();
  for (const [conversationId, count] of Object.entries(options.outboundCounts ?? {})) {
    store.outboundCounts.set(conversationId, count);
  }

  const scripted = new Map<string, string>([
    ['email_intent_classifier', JSON.stringify(makeClassification(classification))],
  ]);
  if (options.routingValidation !== undefined) {
    scripted.set(
      'routing_decision_validator',
      typeof options.routingValidation === 'string'
        ? options.routingValidation
        : JSON.stringify(options.routingValidation),
    );
  }
  const model = new ScriptedModelClient(scripted);

  const orchestrator = new Orchestrator({
    config,
    model,
    processingStore: store,
    promptLoader: new PromptLoader(),
    logger: new NullLogger(),
    mailboxAddress: MAILBOX_ADDRESS,
    now: () => options.now ?? new Date('2026-09-04T10:00:00Z'),
  });

  const { processingId, decision } = await orchestrator.process({
    correlationId: 'test-correlation',
    message: email,
    threadContext,
  });

  const mailbox = new RecordingMailbox();
  const humanReview = new RecordingHumanReview();
  const audit = new RecordingAudit();

  const executor = new ActionExecutor(mailbox, humanReview, audit, new NullLogger());
  await executor.execute(decision, {
    messageId: email.id,
    processingId,
    shadowMode: decision.outcome === 'SHADOW',
  });

  return { decision, model, mailbox, humanReview, audit, store, processingId };
}

/** Every mailbox-affecting flag on, shadow mode off - the "fully live" configuration. */
export const LIVE: HarnessOptions = {
  enable: ['sendResponsesEnabled', 'forwardingEnabled', 'moveEnabled', 'markAsReadEnabled', 'deleteEnabled'],
  disable: ['shadowMode'],
};

export function liveWith(extra: Partial<HarnessOptions>): HarnessOptions {
  return {
    ...LIVE,
    ...extra,
    enable: [...(LIVE.enable ?? []), ...(extra.enable ?? [])],
    disable: [...(LIVE.disable ?? []), ...(extra.disable ?? [])],
    activateTemplates: [...(LIVE.activateTemplates ?? []), ...(extra.activateTemplates ?? [])],
  };
}

/** A validator verdict that agrees, for tests that need the second opinion to pass. */
export const VALIDATOR_AGREES = {
  agrees: true,
  confidence: 0.9,
  concern: null,
  suggestedScenarioId: null,
  injectionSuspected: false,
};

/** A validator verdict that disagrees, with a concern the reviewer would see. */
export const VALIDATOR_DISAGREES = {
  agrees: false,
  confidence: 0.8,
  concern: 'The email also asks for something that would go to a different team.',
  suggestedScenarioId: 'SC-03',
  injectionSuspected: false,
};

export function actionTypes(decision: Decision): string[] {
  return decision.actionPlan.map((a) => a.actionType);
}

export function destinations(decision: Decision): string[] {
  return decision.actionPlan.flatMap((a) => (a.resolvedDestination ? [a.resolvedDestination] : []));
}
