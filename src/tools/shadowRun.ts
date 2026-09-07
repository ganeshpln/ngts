/**
 * Shadow-run CLI.
 *
 *   npm run shadow -- samples/sc07-schoox.json
 *   npm run shadow -- --all
 *   npm run shadow -- --all --as-shipped
 *   npm run shadow -- samples/sc07-schoox.json --json
 *
 * Runs a sample email through the REAL pipeline - real configuration, real classification
 * post-processing, real decision engine, real action validator - with shadow mode on, and prints
 * what the system would have done.
 *
 * Two things it deliberately does NOT do:
 *
 *  - It never touches a mailbox. The MailboxPort passed to the executor throws if called, so
 *    "shadow mode performs no mailbox action" is demonstrated rather than asserted.
 *  - It never invents an AI answer. If Azure OpenAI is configured it calls it; otherwise it uses
 *    the classification stored in the sample file and says so plainly in the output. A scripted
 *    classification exercises the deterministic layer, which is where the controls live - it tells
 *    you nothing about how well the model would classify.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Orchestrator } from '../agent/orchestrator.js';
import { ActionExecutor } from '../actions/actionExecutor.js';
import type { AuditPort, AuditRecord, HumanReviewItem, HumanReviewPort, MailboxPort } from '../actions/ports.js';
import { AzureOpenAiClient, ScriptedModelClient, type ModelClient } from '../classification/modelClient.js';
import { PromptLoader } from '../classification/promptBuilder.js';
import { NullLogger } from '../common/logger.js';
import type { ActionResult, Decision, RawEmail, ThreadMessage } from '../common/types.js';
import { JsonConfigurationStore } from '../configuration/jsonConfigurationStore.js';
import { InMemoryProcessingStore } from '../email/inMemoryProcessingStore.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const SAMPLES_DIR = resolve(REPO_ROOT, 'samples');

interface SampleFile {
  readonly $comment?: string;
  readonly description?: string;
  readonly message: RawEmail;
  readonly threadContext?: ThreadMessage[];
  /** Used only when no Azure OpenAI deployment is configured. */
  readonly scriptedClassification?: unknown;
  /**
   * Scripted routing_decision_validator verdict (prompt 5), used only when no Azure OpenAI
   * deployment is configured. Omit it to see the fail-safe path: with no agreement available, a
   * multi-intent or medium-band email escalates to a human.
   */
  readonly scriptedRoutingValidation?: unknown;
}

/**
 * Capabilities enabled for a shadow run.
 *
 * A shadow run with every capability disabled tells you nothing: the ActionValidator rejects each
 * action on its feature flag, and every email reports as blocked rather than showing the routing
 * decision. So a shadow run enables the capabilities whose behaviour you want to observe, and
 * shadow mode remains the single control that stops anything being executed.
 *
 * `--as-shipped` skips this and runs the committed configuration untouched.
 */
const SHADOW_CAPABILITIES = [
  'sendResponsesEnabled',
  'forwardingEnabled',
  'moveEnabled',
  'markAsReadEnabled',
  'deleteEnabled',
  'changeRequestRoutingEnabled',
] as const;

/** Proves the claim: in shadow mode the executor must not reach the mailbox at all. */
class ForbiddenMailbox implements MailboxPort {
  private fail(operation: string): never {
    throw new Error(
      `Shadow run attempted a real mailbox operation (${operation}). This is a defect: shadow mode ` +
        'must never reach the mailbox.',
    );
  }
  async sendReply(): Promise<ActionResult> { this.fail('sendReply'); }
  async forward(): Promise<ActionResult> { this.fail('forward'); }
  async move(): Promise<{ result: ActionResult; newMessageId: string | null }> { this.fail('move'); }
  async markAsRead(): Promise<ActionResult> { this.fail('markAsRead'); }
  async softDelete(): Promise<ActionResult> { this.fail('softDelete'); }
  async hardDelete(): Promise<ActionResult> { this.fail('hardDelete'); }
}

class CollectingHumanReview implements HumanReviewPort {
  readonly items: HumanReviewItem[] = [];
  async enqueue(item: HumanReviewItem): Promise<ActionResult> {
    this.items.push(item);
    return { sequence: 0, actionType: 'EscalateToHumanReview', status: 'Succeeded' };
  }
}

class CollectingAudit implements AuditPort {
  readonly records: AuditRecord[] = [];
  async recordAction(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';
const useColour = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
const dim = (s: string) => (useColour ? `${DIM}${s}${RESET}` : s);
const bold = (s: string) => (useColour ? `${BOLD}${s}${RESET}` : s);

const RULE = '─'.repeat(78);

function label(name: string, value: string): string {
  return `  ${dim(name.padEnd(14))}${value}`;
}

function describePlan(decision: Decision): string[] {
  if (decision.actionPlan.length === 0) return [`  ${dim('(no actions)')}`];
  return decision.actionPlan.map((item) => {
    const destination = item.resolvedDestination ? ` ${dim('->')} ${item.resolvedDestination}` : '';
    return `  ${String(item.sequence).padStart(2)}. ${item.actionType.padEnd(22)}${destination}`;
  });
}

/** Plain-English summary of the effect, which is the point of a shadow run. */
function describeEffect(decision: Decision): string {
  const parts: string[] = [];
  for (const item of decision.actionPlan) {
    switch (item.actionType) {
      case 'SendResponse':
        parts.push(`reply to ${item.resolvedDestination} using ${String(item.parameters.templateId)}`);
        break;
      case 'ForwardEmail':
      case 'RouteToProgramOwner':
        parts.push(`forward to ${item.resolvedDestination}`);
        break;
      case 'RouteToChangeRequest':
        parts.push(`route to the change-request process${item.resolvedDestination ? ` (${item.resolvedDestination})` : ''}`);
        break;
      case 'MoveEmail':
        parts.push(`file in "${item.resolvedDestination}"`);
        break;
      case 'MarkAsRead':
        parts.push('mark read');
        break;
      case 'DeleteEmail':
        parts.push(item.parameters.hardDelete === true ? 'delete permanently' : 'move to Deleted Items');
        break;
      case 'EscalateToHumanReview':
        parts.push('put it in the human review queue');
        break;
      default:
        parts.push(item.actionType);
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

function render(sampleName: string, sample: SampleFile, decision: Decision, modelSource: string, mailboxCalls: number): void {
  const c = decision.classification;
  const out: string[] = [];

  out.push('');
  out.push(dim(RULE));
  out.push(`${bold('SHADOW RUN')}  ${sampleName}`);
  if (sample.description) out.push(dim(`  ${sample.description}`));
  out.push(dim(RULE));

  out.push(label('From', `${sample.message.from.name ?? ''} <${sample.message.from.address}>`.trim()));
  out.push(label('Subject', sample.message.subject));
  out.push(label('Attachments', String(sample.message.attachments?.length ?? 0)));
  out.push(label('AI source', modelSource));
  out.push('');

  out.push(bold('  CLASSIFICATION'));
  out.push(label('Scenario', `${c.scenarioId}  ${c.scenarioName ?? ''}`));
  out.push(
    label(
      'Programme',
      `${decision.programResolution.program}  ${dim(`(${decision.programResolution.resolvedBy}${decision.programResolution.appliedFallbackRule ? ', both-owners fallback applied' : ''})`)}`,
    ),
  );
  out.push(label('Sender type', c.senderType));
  out.push(
    label(
      'Confidence',
      `${decision.confidence.rawConfidence.toFixed(2)} raw -> ${decision.confidence.effectiveConfidence.toFixed(2)} effective   band ${bold(decision.confidence.band)}`,
    ),
  );
  if (decision.confidence.penaltiesApplied.length > 0) {
    out.push(label('Penalties', decision.confidence.penaltiesApplied.join(', ')));
  }
  out.push(label('Corroborated', decision.confidence.corroborated ? `yes  ${dim(decision.confidence.corroboratingSignals.slice(0, 4).join(', '))}` : 'no'));
  if (decision.multiIntentResolution.multiIntent) {
    out.push(label('Multi-intent', `yes  ${dim(`rule ${decision.multiIntentResolution.ruleApplied ?? '-'}`)}`));
  }
  out.push(label('Reasoning', c.reasoningSummary));
  out.push('');

  out.push(bold('  DECISION'));
  out.push(label('Outcome', decision.outcome === 'SHADOW' ? `${bold('SHADOW')}  ${dim('(would have been EXECUTE)')}` : bold(decision.outcome)));
  if (decision.humanReviewReason) out.push(label('Review reason', decision.humanReviewReason));
  if (decision.suppressionReason) out.push(label('Suppressed', decision.suppressionReason));
  out.push(label('Region', `${decision.regionCode}${decision.regionCode === 'UNMAPPED' ? dim('  (GAP-012 - no mapping supplied)') : ''}`));
  out.push('');

  out.push(bold('  ACTION PLAN'));
  out.push(...describePlan(decision));
  out.push('');

  out.push(label('Would have', describeEffect(decision)));
  out.push(label('Mailbox', mailboxCalls === 0 ? 'no calls made (shadow mode)' : `${mailboxCalls} CALLS MADE - DEFECT`));

  if (decision.warnings.length > 0) {
    out.push('');
    out.push(bold('  WARNINGS'));
    for (const warning of decision.warnings) out.push(`  ${dim('-')} ${warning}`);
  }

  process.stdout.write(`${out.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function buildModelClient(sample: SampleFile): Promise<{ client: ModelClient; source: string }> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (endpoint && deployment) {
    const config = new JsonConfigurationStore();
    const retry = await config.getRetryConfig();
    const ai = retry.dependencies.azureOpenAI ?? { maxAttempts: 2, timeoutMs: 30000 };
    return {
      client: new AzureOpenAiClient({
        endpoint,
        deployment,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
        retryPolicy: { maxAttempts: ai.maxAttempts, timeoutMs: ai.timeoutMs, baseDelayMs: retry.baseDelayMs, maxDelayMs: retry.maxDelayMs },
        getAccessToken: async () => {
          const { DefaultAzureCredential } = await import('@azure/identity');
          const token = await new DefaultAzureCredential().getToken('https://cognitiveservices.azure.com/.default');
          if (!token) throw new Error('Managed Identity token acquisition failed.');
          return token.token;
        },
      }),
      source: `Azure OpenAI (${deployment})`,
    };
  }

  if (sample.scriptedClassification === undefined) {
    throw new Error(
      'No AZURE_OPENAI_ENDPOINT/AZURE_OPENAI_DEPLOYMENT is configured and this sample has no ' +
        'scriptedClassification, so there is no classification to work from.',
    );
  }

  const scripted = new Map<string, string>([
    ['email_intent_classifier', JSON.stringify(sample.scriptedClassification)],
  ]);
  if (sample.scriptedRoutingValidation !== undefined) {
    scripted.set('routing_decision_validator', JSON.stringify(sample.scriptedRoutingValidation));
  }

  return {
    client: new ScriptedModelClient(scripted),
    source: dim(
      `scripted from the sample file (AZURE_OPENAI_ENDPOINT not set)${
        sample.scriptedRoutingValidation === undefined ? '; no validator verdict supplied' : '; includes a validator verdict'
      }`,
    ),
  };
}

async function runSample(path: string, asShipped: boolean, asJson: boolean): Promise<Decision> {
  const raw = await readFile(path, 'utf8');
  const sample = JSON.parse(raw) as SampleFile;

  const config = new JsonConfigurationStore();
  await config.override('application.json', (doc: any) => {
    // Shadow mode stays on in both modes - it is the control that stops execution.
    doc.features.shadowMode.value = true;
    if (!asShipped) {
      for (const flag of SHADOW_CAPABILITIES) {
        if (doc.features[flag]) doc.features[flag].value = true;
      }
    }
  });

  const { client, source } = await buildModelClient(sample);
  const store = new InMemoryProcessingStore();

  const orchestrator = new Orchestrator({
    config,
    model: client,
    processingStore: store,
    promptLoader: new PromptLoader(),
    logger: new NullLogger(),
    mailboxAddress: process.env.SPA_MAILBOX_UPN ?? 'spa@pepsico.com',
  });

  const { processingId, decision } = await orchestrator.process({
    correlationId: `shadow-${Date.now()}`,
    message: sample.message,
    threadContext: sample.threadContext ?? [],
  });

  // Execute the plan against a mailbox that throws if touched, proving shadow mode is real.
  const mailbox = new ForbiddenMailbox();
  const humanReview = new CollectingHumanReview();
  const audit = new CollectingAudit();
  await new ActionExecutor(mailbox, humanReview, audit, new NullLogger()).execute(decision, {
    messageId: sample.message.id,
    processingId,
    shadowMode: true,
  });

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ sample: path, processingId, decision, audit: audit.records }, null, 2)}\n`);
  } else {
    render(path.replace(`${REPO_ROOT}/`, ''), sample, decision, source, 0);
  }

  return decision;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asShipped = args.includes('--as-shipped');
  const asJson = args.includes('--json');
  const all = args.includes('--all');
  const paths = args.filter((a) => !a.startsWith('--'));

  const targets = all
    ? (await readdir(SAMPLES_DIR)).filter((f) => f.endsWith('.json')).sort().map((f) => resolve(SAMPLES_DIR, f))
    : paths.map((p) => resolve(process.cwd(), p));

  if (targets.length === 0) {
    process.stderr.write(
      'Usage: npm run shadow -- <sample.json> [--as-shipped] [--json]\n' +
        '       npm run shadow -- --all\n\n' +
        `Samples live in ${SAMPLES_DIR.replace(`${REPO_ROOT}/`, '')}/\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (!asJson) {
    process.stdout.write(
      `\n${bold('Shadow mode')} - the pipeline classifies, decides, validates and audits; no mailbox action is executed.\n` +
        (asShipped
          ? dim('Running the committed configuration untouched (--as-shipped): every capability is disabled,\n' +
              'so actions are expected to be rejected on their feature flag.\n')
          : dim(`Capabilities enabled for this run so the routing decision is visible: ${SHADOW_CAPABILITIES.join(', ')}.\n`)),
    );
  }

  const outcomes: Record<string, number> = {};
  for (const target of targets) {
    try {
      const decision = await runSample(target, asShipped, asJson);
      outcomes[decision.outcome] = (outcomes[decision.outcome] ?? 0) + 1;
    } catch (error) {
      process.stderr.write(`\nFailed on ${target}: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }

  if (!asJson && targets.length > 1) {
    process.stdout.write(`\n${dim(RULE)}\n${bold('SUMMARY')}  ${targets.length} emails\n`);
    for (const [outcome, count] of Object.entries(outcomes).sort()) {
      process.stdout.write(label(outcome, String(count)) + '\n');
    }
    process.stdout.write('\n');
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Shadow run failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
