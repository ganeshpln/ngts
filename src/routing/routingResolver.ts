/**
 * Routing resolution (Rule 16, FR-027, HIL-04).
 *
 * Destination addresses come from RoutingRule configuration and from nowhere else. The model's
 * proposed `routingEmail` is never consulted here - it is not even a parameter of this function,
 * which is the strongest available guarantee that a prompt injection cannot influence a recipient.
 */

import type { Program, RoutingTarget, SubIntent } from '../common/types.js';
import type { RoutingRuleConfig } from '../configuration/types.js';

export interface RoutingQuery {
  readonly scenarioId: string;
  readonly program: Program;
  readonly subIntent: SubIntent;
}

export interface RoutingResolution {
  readonly resolved: boolean;
  readonly rule: RoutingRuleConfig | null;
  readonly recipients: readonly string[];
  readonly routingTarget: RoutingTarget | null;
  readonly ownerName: string | null;
  readonly destinationFolder: string | null;
  readonly responseTemplateId: string | null;
  /** True when the BRD's "send to both Josh and Jordon" fallback produced these recipients. */
  readonly appliedBothOwnersFallback: boolean;
  readonly failureReason: string | null;
}

const UNRESOLVED: RoutingResolution = {
  resolved: false,
  rule: null,
  recipients: [],
  routingTarget: null,
  ownerName: null,
  destinationFolder: null,
  responseTemplateId: null,
  appliedBothOwnersFallback: false,
  failureReason: null,
};

/**
 * Select the rule for (scenario, programme, sub-intent).
 *
 * A rule whose `subIntent` is set matches only that sub-intent. When the classifier could not
 * determine a sub-intent for a branching scenario, NO rule matches and the caller escalates - which
 * is correct: SC-03's two branches go to different teams, and guessing between them is exactly the
 * error the human review queue exists to prevent.
 */
export function selectRule(
  rules: readonly RoutingRuleConfig[],
  query: RoutingQuery,
): RoutingRuleConfig | null {
  const candidates = rules.filter((r) => r.scenarioId === query.scenarioId && r.isActive);
  if (candidates.length === 0) return null;

  const subIntentMatches = candidates.filter((r) =>
    query.subIntent === null ? r.subIntent === null : r.subIntent === query.subIntent,
  );
  if (subIntentMatches.length === 0) return null;

  const byPriority = (a: RoutingRuleConfig, b: RoutingRuleConfig) => a.priority - b.priority;

  // Exact programme match wins; the ALL wildcard is the fallback.
  const exact = subIntentMatches.filter((r) => r.program === query.program).sort(byPriority);
  if (exact.length > 0) return exact[0] ?? null;

  const wildcard = subIntentMatches.filter((r) => r.program === 'ALL').sort(byPriority);
  return wildcard[0] ?? null;
}

export function resolveRouting(
  rules: readonly RoutingRuleConfig[],
  query: RoutingQuery,
): RoutingResolution {
  const rule = selectRule(rules, query);

  if (!rule) {
    return {
      ...UNRESOLVED,
      failureReason:
        query.subIntent === null
          ? `No routing rule for ${query.scenarioId} without a sub-intent; the branch could not be determined.`
          : `No routing rule for ${query.scenarioId} / ${query.program} / ${query.subIntent}.`,
    };
  }

  const recipients = rule.ownerEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const needsRecipient = rule.routingTarget === 'PROGRAM_OWNER' || rule.routingTarget === 'SCHOOX_OWNER';

  if (needsRecipient && recipients.length === 0) {
    return {
      ...UNRESOLVED,
      rule,
      routingTarget: rule.routingTarget,
      failureReason: `Routing rule ${rule.ruleId} has no configured owner address (HIL-04).`,
    };
  }

  if (rule.routingTarget === 'CHANGE_REQUEST' && recipients.length === 0) {
    // Expected while GAP-003 is open. Not an error - the caller decides what to do about it, and
    // with change-request routing disabled the item goes to a human.
    return {
      resolved: true,
      rule,
      recipients: [],
      routingTarget: rule.routingTarget,
      ownerName: rule.ownerName,
      destinationFolder: rule.destinationFolder,
      responseTemplateId: rule.responseTemplateId,
      appliedBothOwnersFallback: false,
      failureReason: 'Change-request destination is not configured (GAP-003).',
    };
  }

  return {
    resolved: true,
    rule,
    recipients,
    routingTarget: rule.routingTarget,
    ownerName: rule.ownerName,
    destinationFolder: rule.destinationFolder,
    responseTemplateId: rule.responseTemplateId,
    // Rule R-1 (FR-027): the UNKNOWN-programme rule carries both owners.
    appliedBothOwnersFallback: query.program === 'UNKNOWN' && recipients.length > 1,
    failureReason: null,
  };
}
