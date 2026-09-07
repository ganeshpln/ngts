/**
 * HTTP handlers for the Decision Service (docs/solution-design.md section 7).
 *
 * Framework-agnostic: each handler takes a parsed request and returns a status and body. The Azure
 * Functions binding in src/api/functions.ts is a thin adapter over these, which keeps the request
 * handling testable without a host.
 */

import { newCorrelationId } from '../common/hash.js';
import type { Logger } from '../common/logger.js';
import type { ActionResult, RawEmail, ThreadMessage } from '../common/types.js';
import type { ConfigurationStore } from '../configuration/types.js';
import { validateConfiguration } from '../configuration/validate.js';
import type { Orchestrator } from '../agent/orchestrator.js';
import { buildWeeklyReport, weekWindowFor, type ProcessingSummaryRow } from '../reporting/weeklyReport.js';

export interface HandlerResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface HandlerDependencies {
  readonly orchestrator: Orchestrator;
  readonly config: ConfigurationStore;
  readonly logger: Logger;
  readonly recordActionResults?: (processingId: string, results: readonly ActionResult[]) => Promise<void>;
  readonly loadProcessingRows?: (from: Date, to: Date) => Promise<readonly ProcessingSummaryRow[]>;
}

function badRequest(message: string): HandlerResponse {
  return { status: 400, body: { error: 'BadRequest', message } };
}

function isRawEmail(value: unknown): value is RawEmail {
  if (value === null || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.internetMessageId === 'string' &&
    typeof m.subject === 'string' &&
    typeof m.body === 'object' &&
    m.body !== null &&
    typeof m.from === 'object'
  );
}

/** Fill in the optional collections Graph may omit, so downstream code has no undefined checks. */
function normaliseRequestShape(message: RawEmail): RawEmail {
  return {
    ...message,
    conversationId: message.conversationId ?? '',
    toRecipients: message.toRecipients ?? [],
    ccRecipients: message.ccRecipients ?? [],
    internetMessageHeaders: message.internetMessageHeaders ?? [],
    attachments: message.attachments ?? [],
    hasAttachments: message.hasAttachments ?? (message.attachments ?? []).length > 0,
  };
}

/**
 * POST /api/process - the full pipeline for one message.
 *
 * Returns the decision and the APPROVED action plan. Power Automate executes that plan verbatim and
 * makes no decisions of its own.
 */
export async function handleProcess(deps: HandlerDependencies, body: unknown): Promise<HandlerResponse> {
  const payload = (body ?? {}) as { correlationId?: string; message?: unknown; threadContext?: ThreadMessage[] };

  if (!isRawEmail(payload.message)) {
    return badRequest('A "message" object with id, internetMessageId, subject, body and from is required.');
  }

  const correlationId = typeof payload.correlationId === 'string' ? payload.correlationId : newCorrelationId();

  try {
    const result = await deps.orchestrator.process({
      correlationId,
      message: normaliseRequestShape(payload.message),
      threadContext: payload.threadContext ?? [],
    });

    const { decision } = result;
    return {
      status: 200,
      body: {
        processingId: result.processingId,
        correlationId,
        outcome: decision.outcome,
        confidenceBand: decision.confidence.band,
        confidence: decision.confidence.effectiveConfidence,
        classification: {
          scenarioId: decision.classification.scenarioId,
          scenarioName: decision.classification.scenarioName,
          program: decision.programResolution.program,
          subIntent: decision.classification.subIntent ?? null,
          multiIntent: decision.multiIntentResolution.multiIntent,
          senderType: decision.classification.senderType,
          extractedEntities: decision.classification.extractedEntities,
          // Business-readable only; chain-of-thought is prohibited and length-capped (Rule 11).
          reasoningSummary: decision.classification.reasoningSummary,
        },
        actionPlan: decision.actionPlan,
        humanReviewReason: decision.humanReviewReason,
        suppressionReason: decision.suppressionReason,
        regionCode: decision.regionCode,
        warnings: decision.warnings,
        appliedBothOwnersFallback: decision.programResolution.appliedFallbackRule,
      },
    };
  } catch (error) {
    // A crash must not lose the email: 500 makes Power Automate retry, and the idempotency claim
    // makes that retry safe.
    deps.logger.error('Processing failed', {
      correlationId,
      stage: 'Ingest',
      errorCode: error instanceof Error ? error.name : 'Unknown',
    });
    return { status: 500, body: { error: 'ProcessingFailed', correlationId } };
  }
}

/** POST /api/actions/result - record what Power Automate actually did (FR-013). */
export async function handleActionResults(deps: HandlerDependencies, body: unknown): Promise<HandlerResponse> {
  const payload = (body ?? {}) as { processingId?: unknown; results?: unknown };
  if (typeof payload.processingId !== 'string' || !Array.isArray(payload.results)) {
    return badRequest('"processingId" (string) and "results" (array) are required.');
  }
  await deps.recordActionResults?.(payload.processingId, payload.results as ActionResult[]);
  return { status: 202, body: { processingId: payload.processingId, recorded: payload.results.length } };
}

/** POST /api/reports/weekly - the Friday report (FR-090 to FR-098). */
export async function handleWeeklyReport(deps: HandlerDependencies, body: unknown): Promise<HandlerResponse> {
  const payload = (body ?? {}) as { reportDate?: string };
  const reportDate = payload.reportDate ? new Date(payload.reportDate) : new Date();
  if (Number.isNaN(reportDate.getTime())) return badRequest('"reportDate" is not a valid date.');

  const { periodStart, periodEnd } = weekWindowFor(reportDate);

  if (!deps.loadProcessingRows) {
    return { status: 501, body: { error: 'NotConfigured', message: 'No processing data source is configured.' } };
  }

  const [rows, scenarios, reporting, routingRules] = await Promise.all([
    deps.loadProcessingRows(periodStart, periodEnd),
    deps.config.getScenarios(),
    deps.config.getReportingConfig(),
    deps.config.getRoutingRules(),
  ]);

  // Owner addresses come from routing configuration, so the report does not hard-code who the
  // programme and Schoox owners are.
  const programOwnerAddresses = [
    ...new Set(routingRules.filter((r) => r.routingTarget === 'PROGRAM_OWNER').flatMap((r) => r.ownerEmails)),
  ];
  const schooxOwnerAddresses = [
    ...new Set(routingRules.filter((r) => r.routingTarget === 'SCHOOX_OWNER').flatMap((r) => r.ownerEmails)),
  ];

  const report = buildWeeklyReport({
    periodStart,
    periodEnd,
    rows,
    scenarioCatalogue: scenarios
      .filter((s) => s.scenarioId !== 'SC-99')
      .map((s) => ({ scenarioId: s.scenarioId, scenarioName: s.scenarioName })),
    unmappedRegionCode: reporting.unmappedRegionCode,
    programOwnerAddresses,
    schooxOwnerAddresses,
  });

  return {
    status: 200,
    body: {
      report,
      recipients: reporting.recipients,
      // GAP-014: with no recipients configured there is no default to fall back on, so the caller
      // is told plainly rather than the report being sent somewhere guessed.
      deliverable: reporting.recipients.length > 0,
    },
  };
}

/**
 * GET /api/health - liveness AND configuration readiness.
 *
 * Returns 503 when configuration is invalid, because a service that cannot trust its own routing
 * rules must not be given traffic (fail closed).
 */
export async function handleHealth(deps: HandlerDependencies): Promise<HandlerResponse> {
  const report = await validateConfiguration(deps.config);
  const flags = await deps.config.getFeatureFlags();

  return {
    status: report.valid ? 200 : 503,
    body: {
      status: report.valid ? 'healthy' : 'unhealthy',
      configurationValid: report.valid,
      errors: report.issues.filter((i) => i.severity === 'error'),
      warnings: report.issues.filter((i) => i.severity === 'warning'),
      mode: flags.shadowMode ? 'shadow' : 'live',
      outboundEnabled: {
        send: flags.sendResponsesEnabled,
        forward: flags.forwardingEnabled,
        move: flags.moveEnabled,
        delete: flags.deleteEnabled,
        changeRequest: flags.changeRequestRoutingEnabled,
      },
    },
  };
}
