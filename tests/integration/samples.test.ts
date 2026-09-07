/**
 * Guards the shadow-run samples.
 *
 * The samples exist to be run by hand (`npm run shadow -- --all`), which means they rot silently
 * when configuration changes. These tests keep them honest: every sample must still parse, still
 * produce a decision, and - the property the shadow CLI is built to demonstrate - must never reach
 * the mailbox.
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ActionExecutor } from '../../src/actions/actionExecutor.js';
import type { MailboxPort } from '../../src/actions/ports.js';
import type { ActionResult } from '../../src/common/types.js';
import { Orchestrator } from '../../src/agent/orchestrator.js';
import { ScriptedModelClient } from '../../src/classification/modelClient.js';
import { PromptLoader } from '../../src/classification/promptBuilder.js';
import { NullLogger } from '../../src/common/logger.js';
import type { RawEmail, ThreadMessage } from '../../src/common/types.js';
import { InMemoryProcessingStore } from '../../src/email/inMemoryProcessingStore.js';
import { buildConfig } from '../helpers/harness.js';
import { RecordingHumanReview, RecordingAudit } from '../helpers/fixtures.js';

const SAMPLES_DIR = resolve(process.cwd(), 'samples');

interface SampleFile {
  description?: string;
  message: RawEmail;
  threadContext?: ThreadMessage[];
  scriptedClassification?: unknown;
  scriptedRoutingValidation?: unknown;
}

/** Mirrors the CLI: any call is a defect, so shadow mode is demonstrated rather than asserted. */
class ForbiddenMailbox implements MailboxPort {
  calls = 0;
  private fail(op: string): never {
    this.calls += 1;
    throw new Error(`Shadow mode reached the mailbox (${op}).`);
  }
  async sendReply(): Promise<ActionResult> { this.fail('sendReply'); }
  async forward(): Promise<ActionResult> { this.fail('forward'); }
  async move(): Promise<{ result: ActionResult; newMessageId: string | null }> { this.fail('move'); }
  async markAsRead(): Promise<ActionResult> { this.fail('markAsRead'); }
  async softDelete(): Promise<ActionResult> { this.fail('softDelete'); }
  async hardDelete(): Promise<ActionResult> { this.fail('hardDelete'); }
}

const SHADOW_CAPABILITIES = [
  'sendResponsesEnabled', 'forwardingEnabled', 'moveEnabled',
  'markAsReadEnabled', 'deleteEnabled', 'changeRequestRoutingEnabled',
];

async function runSample(file: string) {
  const sample = JSON.parse(await readFile(resolve(SAMPLES_DIR, file), 'utf8')) as SampleFile;

  const config = await buildConfig({ enable: SHADOW_CAPABILITIES });
  await config.override('application.json', (doc: any) => {
    doc.features.shadowMode.value = true;
  });

  const orchestrator = new Orchestrator({
    config,
    model: new ScriptedModelClient(
      (() => {
        const scripted = new Map<string, string>([
          ['email_intent_classifier', JSON.stringify(sample.scriptedClassification)],
        ]);
        if (sample.scriptedRoutingValidation !== undefined) {
          scripted.set('routing_decision_validator', JSON.stringify(sample.scriptedRoutingValidation));
        }
        return scripted;
      })(),
    ),
    processingStore: new InMemoryProcessingStore(),
    promptLoader: new PromptLoader(),
    logger: new NullLogger(),
    mailboxAddress: 'spa@pepsico.com',
  });

  const { processingId, decision } = await orchestrator.process({
    correlationId: 'sample-test',
    message: sample.message,
    threadContext: sample.threadContext ?? [],
  });

  const mailbox = new ForbiddenMailbox();
  const audit = new RecordingAudit();
  await new ActionExecutor(mailbox, new RecordingHumanReview(), audit, new NullLogger()).execute(decision, {
    messageId: sample.message.id,
    processingId,
    shadowMode: true,
  });

  return { sample, decision, mailbox, audit };
}

const files = (await readdir(SAMPLES_DIR)).filter((f) => f.endsWith('.json')).sort();

describe('shadow-run samples', () => {
  it('ships a usable sample set', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of files) {
    describe(file, () => {
      it('produces a decision and never reaches the mailbox', async () => {
        const { decision, mailbox, audit } = await runSample(file);
        expect(mailbox.calls).toBe(0);
        expect(['SHADOW', 'HUMAN_REVIEW', 'SUPPRESS']).toContain(decision.outcome);
        // Shadow mode still audits, which is what makes the pilot worth running.
        expect(audit.records.length).toBeGreaterThan(0);
      });

      it('carries a scripted classification so it runs without a model', async () => {
        const sample = JSON.parse(await readFile(resolve(SAMPLES_DIR, file), 'utf8')) as SampleFile;
        expect(sample.scriptedClassification).toBeDefined();
        expect(sample.description).toBeTruthy();
      });
    });
  }
});

describe('what the samples demonstrate', () => {
  it('routes a Schoox email to Amy alone', async () => {
    const { decision } = await runSample('01-sc07-schoox.json');
    const destinations = decision.actionPlan.map((a) => a.resolvedDestination).join(' ');
    expect(destinations).toContain('amy.fischer@pepsico.com');
    expect(destinations).not.toContain('jordan.beahrs');
    expect(destinations).not.toContain('josh.baxter');
  });

  it('applies the both-owners fallback when no programme is named (FR-027)', async () => {
    const { decision } = await runSample('02-sc10-unknown-program.json');
    const destinations = decision.actionPlan.map((a) => a.resolvedDestination).join(' ');
    expect(decision.programResolution.appliedFallbackRule).toBe(true);
    expect(destinations).toContain('jordan.beahrs@pepsico.com');
    expect(destinations).toContain('josh.baxter@pepsico.com');
  });

  it('soft-deletes an out-of-office reply and sends nothing', async () => {
    const { decision } = await runSample('03-sc08-out-of-office.json');
    const actions = decision.actionPlan.map((a) => a.actionType);
    expect(actions).toContain('DeleteEmail');
    expect(actions).not.toContain('SendResponse');
    expect(decision.actionPlan.find((a) => a.actionType === 'DeleteEmail')?.parameters.hardDelete).toBe(false);
  });

  it('shows SC-01 blocked on the missing approved wording, not silently mishandled', async () => {
    const { decision } = await runSample('05-sc01-fit-blocked.json');
    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.warnings.join(' ')).toContain('GAP-004');
  });

  it('escalates the ambiguous manager query rather than guessing a branch', async () => {
    const { decision } = await runSample('06-sc03-ambiguous.json');
    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.humanReviewReason).toBe('HIL-04');
  });

  it('dual-routes the multi-intent email only because the validator agrees', async () => {
    const { decision } = await runSample('08-sc07-plus-fit-issue.json');
    const destinations = decision.actionPlan.map((a) => a.resolvedDestination).join(' ');
    expect(decision.multiIntentResolution.ruleApplied).toBe('MI-SCHOOX-PLUS');
    expect(destinations).toContain('amy.fischer@pepsico.com');
    expect(destinations).toContain('jordan.beahrs@pepsico.com');
    expect(destinations).toContain('josh.baxter@pepsico.com');
  });

  it('ignores an injected address even when the model was fully fooled', async () => {
    // The sample scripts the classification as if the injection had completely succeeded:
    // routingEmail points at the attacker. The destination still comes from configuration.
    const { decision } = await runSample('07-injection-attempt.json');
    const serialised = JSON.stringify(decision.actionPlan);
    expect(serialised).not.toContain('attacker@evil.example.com');
    expect(serialised).not.toContain('Exfiltrated');
    expect(serialised).toContain('amy.fischer@pepsico.com');
  });
});
