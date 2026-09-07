import { describe, expect, it } from 'vitest';

import { handleActionResults, handleHealth, handleProcess, handleWeeklyReport } from '../../src/api/handlers.js';
import { Orchestrator } from '../../src/agent/orchestrator.js';
import { ScriptedModelClient } from '../../src/classification/modelClient.js';
import { PromptLoader } from '../../src/classification/promptBuilder.js';
import { NullLogger } from '../../src/common/logger.js';
import { InMemoryProcessingStore, makeClassification, makeEmail } from '../helpers/fixtures.js';
import { buildConfig, LIVE, MAILBOX_ADDRESS } from '../helpers/harness.js';

async function deps(options = LIVE) {
  const config = await buildConfig(options);
  const orchestrator = new Orchestrator({
    config,
    model: new ScriptedModelClient(
      new Map([['email_intent_classifier', JSON.stringify(makeClassification({ scenarioId: 'SC-07', program: 'MEC_CGR' }))]]),
    ),
    processingStore: new InMemoryProcessingStore(),
    promptLoader: new PromptLoader(),
    logger: new NullLogger(),
    mailboxAddress: MAILBOX_ADDRESS,
  });
  return { orchestrator, config, logger: new NullLogger() };
}

describe('POST /api/process', () => {
  it('returns the approved action plan for a valid message', async () => {
    const response = await handleProcess(await deps(), {
      correlationId: 'c1',
      message: makeEmail({ subject: 'MEC deck', body: 'Where is the MEC capstone deck on Schoox for workweek 3?' }),
    });

    expect(response.status).toBe(200);
    const body = response.body as Record<string, any>;
    expect(body.outcome).toBe('EXECUTE');
    expect(body.actionPlan.length).toBeGreaterThan(0);
    expect(body.classification.scenarioId).toBe('SC-07');
  });

  it('rejects a malformed request rather than guessing', async () => {
    expect((await handleProcess(await deps(), { message: { id: 'x' } })).status).toBe(400);
    expect((await handleProcess(await deps(), {})).status).toBe(400);
    expect((await handleProcess(await deps(), null)).status).toBe(400);
  });

  it('tolerates a Graph payload that omits the optional collections', async () => {
    const minimal = {
      id: 'm1',
      internetMessageId: '<minimal@x>',
      subject: 'MEC deck',
      body: { contentType: 'text', content: 'Where is the MEC capstone deck on Schoox for workweek 3?' },
      from: { address: 'learner@pepsico.com' },
      receivedDateTime: '2026-09-02T09:00:00Z',
      isRead: false,
    };
    const response = await handleProcess(await deps(), { message: minimal });
    expect(response.status).toBe(200);
  });

  it('never returns anything resembling chain-of-thought', async () => {
    const response = await handleProcess(await deps(), {
      message: makeEmail({ body: 'Where is the MEC capstone deck on Schoox for workweek 3?' }),
    });
    const body = response.body as Record<string, any>;
    expect(body.classification.reasoningSummary.length).toBeLessThanOrEqual(600);
    expect(JSON.stringify(body)).not.toContain('chainOfThought');
  });
});

describe('POST /api/actions/result', () => {
  it('accepts a well-formed result batch', async () => {
    const response = await handleActionResults(await deps(), {
      processingId: 'p1',
      results: [{ sequence: 1, actionType: 'MoveEmail', status: 'Succeeded' }],
    });
    expect(response.status).toBe(202);
  });

  it('rejects a batch with no processing id', async () => {
    expect((await handleActionResults(await deps(), { results: [] })).status).toBe(400);
  });
});

describe('GET /api/health', () => {
  it('reports healthy with the shipped configuration and names the mode', async () => {
    const response = await handleHealth(await deps({}));
    expect(response.status).toBe(200);
    const body = response.body as Record<string, any>;
    expect(body.configurationValid).toBe(true);
    expect(body.mode).toBe('shadow');
    expect(body.outboundEnabled.send).toBe(false);
  });

  it('fails closed when configuration is invalid', async () => {
    const config = await buildConfig();
    await config.override('scenarios.json', (doc) => {
      doc.scenarios[0].allowedActions.push('TransferFunds');
    });
    const response = await handleHealth({ ...(await deps()), config });
    expect(response.status).toBe(503);
  });
});

describe('POST /api/reports/weekly', () => {
  it('builds the report from the supplied rows', async () => {
    const base = await deps();
    const response = await handleWeeklyReport(
      {
        ...base,
        loadProcessingRows: async () => [
          {
            processingId: '1', receivedDateTime: '2026-09-02T09:00:00Z', scenarioId: 'SC-07',
            scenarioName: 'Schoox', program: 'MEC_CGR' as const, regionCode: 'UNMAPPED',
            routingEmails: ['amy.fischer@pepsico.com'], routingTarget: 'SCHOOX_OWNER',
            outcome: 'EXECUTE', humanReviewRequired: false,
          },
        ],
      },
      { reportDate: '2026-09-04T17:00:00Z' },
    );

    expect(response.status).toBe(200);
    const body = response.body as Record<string, any>;
    expect(body.report.routedToSchooxOwner).toBe(1);
    expect(body.report.scenarioByRegion).toHaveLength(12);
    // GAP-014: no recipients configured, so the caller is told the report cannot be delivered
    // rather than it being sent to a guessed address.
    expect(body.deliverable).toBe(false);
  });

  it('rejects an invalid report date', async () => {
    expect((await handleWeeklyReport(await deps(), { reportDate: 'not-a-date' })).status).toBe(400);
  });

  it('reports not-configured rather than inventing data when no source is wired', async () => {
    expect((await handleWeeklyReport(await deps(), {})).status).toBe(501);
  });
});
