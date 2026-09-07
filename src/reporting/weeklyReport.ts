/**
 * Weekly Friday report (BRD section 19, FR-090 to FR-098).
 *
 * A pure function of the processing rows, so the whole report is unit-testable without a database.
 * It produces exactly the seven sections the BRD asks for, plus the unmapped-region count that
 * keeps GAP-012 visible.
 */

import type { Program } from '../common/types.js';

export interface ProcessingSummaryRow {
  readonly processingId: string;
  readonly receivedDateTime: string;
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly program: Program;
  readonly regionCode: string;
  readonly routingEmails: readonly string[];
  readonly routingTarget: string | null;
  readonly outcome: string;
  readonly humanReviewRequired: boolean;
}

export interface WeeklyReportRequest {
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly rows: readonly ProcessingSummaryRow[];
  readonly scenarioCatalogue: readonly { readonly scenarioId: string; readonly scenarioName: string }[];
  readonly unmappedRegionCode: string;
  /** From routing configuration, so the report does not hard-code who "Josh/Jordan/Amy" are. */
  readonly programOwnerAddresses: readonly string[];
  readonly schooxOwnerAddresses: readonly string[];
}

export interface ScenarioRegionCount {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly regionCode: string;
  readonly count: number;
}

export interface WeeklyReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly generatedAt: string;
  /** BRD 19.1 */
  readonly emailsByRegion: Readonly<Record<string, number>>;
  /** BRD 19.2 and 19.7 - every scenario against every region, including zeroes. */
  readonly scenarioByRegion: readonly ScenarioRegionCount[];
  /** BRD 19.3 */
  readonly forwardedToProgramOwners: number;
  /** BRD 19.4 */
  readonly routedToSchooxOwner: number;
  /** BRD 19.5 */
  readonly routedToChangeRequest: number;
  /** BRD 19.6 */
  readonly resolved: number;
  readonly totalEmails: number;
  readonly humanReviewCount: number;
  readonly unmappedRegionCount: number;
  readonly gaps: readonly string[];
}

function within(row: ProcessingSummaryRow, start: Date, end: Date): boolean {
  const t = new Date(row.receivedDateTime).getTime();
  return !Number.isNaN(t) && t >= start.getTime() && t < end.getTime();
}

function intersects(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(b.map((x) => x.toLowerCase()));
  return a.some((x) => set.has(x.toLowerCase()));
}

export function buildWeeklyReport(request: WeeklyReportRequest, now: Date = new Date()): WeeklyReport {
  const rows = request.rows.filter((r) => within(r, request.periodStart, request.periodEnd));

  const emailsByRegion: Record<string, number> = {};
  const counts = new Map<string, number>();
  const regions = new Set<string>();

  for (const row of rows) {
    regions.add(row.regionCode);
    emailsByRegion[row.regionCode] = (emailsByRegion[row.regionCode] ?? 0) + 1;
    const key = `${row.scenarioId}|${row.regionCode}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // BRD 19.7 asks for "scenario counts for all 12 scenarios across all regions" - so every
  // combination is emitted, including zeroes. A missing row and a zero row read very differently
  // to someone checking whether a scenario is being handled at all.
  const regionList = regions.size > 0 ? [...regions].sort() : [request.unmappedRegionCode];
  const scenarioByRegion: ScenarioRegionCount[] = [];
  for (const scenario of request.scenarioCatalogue) {
    for (const regionCode of regionList) {
      scenarioByRegion.push({
        scenarioId: scenario.scenarioId,
        scenarioName: scenario.scenarioName,
        regionCode,
        count: counts.get(`${scenario.scenarioId}|${regionCode}`) ?? 0,
      });
    }
  }

  const forwardedToProgramOwners = rows.filter(
    (r) => r.routingTarget === 'PROGRAM_OWNER' && intersects(r.routingEmails, request.programOwnerAddresses),
  ).length;

  const routedToSchooxOwner = rows.filter(
    (r) => r.routingTarget === 'SCHOOX_OWNER' || intersects(r.routingEmails, request.schooxOwnerAddresses),
  ).length;

  const routedToChangeRequest = rows.filter((r) => r.routingTarget === 'CHANGE_REQUEST').length;
  const resolved = rows.filter((r) => r.scenarioId === 'SC-11').length;
  const unmappedRegionCount = rows.filter((r) => r.regionCode === request.unmappedRegionCode).length;

  const gaps: string[] = [];
  if (unmappedRegionCount > 0) {
    gaps.push(
      `${unmappedRegionCount} of ${rows.length} messages could not be assigned to a region because the region ` +
        'mapping has not been supplied (GAP-012, question Q-06).',
    );
  }

  return {
    periodStart: request.periodStart.toISOString(),
    periodEnd: request.periodEnd.toISOString(),
    generatedAt: now.toISOString(),
    emailsByRegion,
    scenarioByRegion,
    forwardedToProgramOwners,
    routedToSchooxOwner,
    routedToChangeRequest,
    resolved,
    totalEmails: rows.length,
    humanReviewCount: rows.filter((r) => r.humanReviewRequired).length,
    unmappedRegionCount,
    gaps,
  };
}

/**
 * Previous Monday 00:00 UTC to the following Monday 00:00 UTC, relative to the Friday the report
 * runs. Exclusive upper bound so a message is never counted in two weeks.
 */
export function weekWindowFor(reportDate: Date): { periodStart: Date; periodEnd: Date } {
  const end = new Date(Date.UTC(reportDate.getUTCFullYear(), reportDate.getUTCMonth(), reportDate.getUTCDate()));
  const dayOfWeek = end.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - daysSinceMonday);
  const periodEnd = new Date(start);
  periodEnd.setUTCDate(start.getUTCDate() + 7);
  return { periodStart: start, periodEnd };
}
