/**
 * The final gate before anything touches the mailbox (FR-049, Rules 12, 14, 15, 16).
 *
 * Everything upstream - the model, the prompts, the decision engine - proposes. This module
 * disposes. It is deliberately paranoid and re-checks facts the caller has already established,
 * because it is the single place where "the AI cannot cause X" becomes true rather than intended.
 *
 * Every rejection is a guardrail violation and routes to human review (HIL-09). Nothing is
 * silently downgraded or skipped.
 */

import { meetsBandForAction } from '../classification/confidence.js';
import type {
  ActionPlanItem,
  ActionType,
  ConfidenceBand,
} from '../common/types.js';
import type { FeatureFlags, ResponseTemplateConfig, SafetyConfig, ScenarioConfig, ThresholdConfig } from '../configuration/types.js';

export interface ValidationContext {
  readonly scenario: ScenarioConfig;
  readonly flags: FeatureFlags;
  readonly safety: SafetyConfig;
  readonly thresholds: ThresholdConfig;
  readonly band: ConfidenceBand;
  /** Addresses the routing configuration produced for this decision - the ONLY legal recipients. */
  readonly configuredRecipients: readonly string[];
  /** Folder names the configuration knows about. */
  readonly configuredFolders: readonly string[];
  readonly templates: readonly ResponseTemplateConfig[];
}

export interface ActionVerdict {
  readonly approved: boolean;
  readonly code: string | null;
  readonly reason: string | null;
}

const APPROVED: ActionVerdict = { approved: true, code: null, reason: null };

function reject(code: string, reason: string): ActionVerdict {
  return { approved: false, code, reason };
}

const FEATURE_FLAG_FOR: Partial<Record<ActionType, keyof FeatureFlags>> = {
  SendResponse: 'sendResponsesEnabled',
  ForwardEmail: 'forwardingEnabled',
  RouteToProgramOwner: 'forwardingEnabled',
  RouteToChangeRequest: 'changeRequestRoutingEnabled',
  MoveEmail: 'moveEnabled',
  MarkAsRead: 'markAsReadEnabled',
  DeleteEmail: 'deleteEnabled',
};

function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase() : '';
}

function isAllowedDomain(address: string, safety: SafetyConfig): boolean {
  const domain = domainOf(address);
  return safety.allowedRecipientDomains.some(
    (d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`),
  );
}

export function validateAction(item: ActionPlanItem, ctx: ValidationContext): ActionVerdict {
  const { scenario, flags, safety, thresholds } = ctx;

  // 1. The action must be one of the nine approved actions (FR-031). An unrecognised name never
  //    reaches an executor.
  if (!scenario.allowedActions.includes(item.actionType)) {
    return reject(
      'AV-001',
      `Action "${item.actionType}" is not permitted for ${scenario.scenarioId} by its configured action set.`,
    );
  }

  // 2. Rule 14 - sending requires explicit scenario permission. Silence is not permission.
  if (item.actionType === 'SendResponse' && !scenario.sendResponseAllowed) {
    return reject('AV-002', `${scenario.scenarioId} does not permit an automated response (Rule 14).`);
  }

  // 3. Rule 15 - deletion is permitted for SC-08 only.
  if (item.actionType === 'DeleteEmail' && !scenario.deleteAllowed) {
    return reject('AV-003', `${scenario.scenarioId} does not permit deletion (Rule 15).`);
  }

  // 4. AD-005 - a destructive action needs the configured minimum confidence band, whatever any
  //    per-scenario override says.
  if (!meetsBandForAction(item.actionType, ctx.band, thresholds)) {
    return reject(
      'AV-004',
      `Action "${item.actionType}" requires the ${thresholds.confidence.destructiveActionMinimumBand} confidence band but the item is ${ctx.band}.`,
    );
  }

  // 5. Feature flag - the ships-disabled posture (docs/solution-design.md section 9).
  const flag = FEATURE_FLAG_FOR[item.actionType];
  if (flag && !flags[flag]) {
    return reject('AV-005', `Action "${item.actionType}" is disabled by feature flag "${String(flag)}".`);
  }

  // 6. Rule 16 - every recipient must appear in the routing configuration for THIS decision. An
  //    address the model invented, or one carried over from email content, cannot pass here.
  const recipients = item.parameters.toRecipients ?? [];
  if (['SendResponse', 'ForwardEmail', 'RouteToProgramOwner', 'RouteToChangeRequest'].includes(item.actionType)) {
    if (item.actionType !== 'SendResponse' && recipients.length === 0) {
      return reject('AV-006', `Action "${item.actionType}" has no recipient; routing did not resolve one (HIL-04).`);
    }
    const configured = new Set(ctx.configuredRecipients.map((r) => r.toLowerCase()));
    for (const recipient of recipients) {
      const normalised = recipient.toLowerCase();
      if (!configured.has(normalised)) {
        return reject(
          'AV-007',
          `Recipient "${normalised}" is not in the routing configuration for this decision (Rule 16).`,
        );
      }
      // 7. GAP-017 - outbound to a non-allow-listed domain is blocked until Business confirms.
      if (!isAllowedDomain(normalised, safety) && !flags.externalRecipientsEnabled) {
        return reject('AV-008', `Recipient domain "${domainOf(normalised)}" is not in the allowed domain list (GAP-017).`);
      }
    }
  }

  // 8. A reply must carry an active template. Rendered text is verified separately by the renderer.
  if (item.actionType === 'SendResponse') {
    const templateId = item.parameters.templateId;
    if (!templateId) {
      return reject('AV-009', 'SendResponse has no template; free-form generation is prohibited (BRD section 16).');
    }
    const template = ctx.templates.find((t) => t.templateId === templateId);
    if (!template) {
      return reject('AV-010', `Template "${templateId}" does not exist.`);
    }
    if (!template.isActive) {
      return reject('AV-011', `Template "${templateId}" is inactive; approved wording is not available (GAP-004).`);
    }
    if (template.scenarioId !== scenario.scenarioId) {
      return reject('AV-012', `Template "${templateId}" belongs to ${template.scenarioId}, not ${scenario.scenarioId}.`);
    }
    if (typeof item.parameters.body !== 'string' || item.parameters.body.length === 0) {
      return reject('AV-013', 'SendResponse has no rendered body.');
    }
  }

  // 9. A move needs a folder the configuration knows about (GAP-005).
  if (item.actionType === 'MoveEmail') {
    const folder = item.parameters.destinationFolder;
    if (!folder) {
      return reject('AV-014', 'MoveEmail has no destination folder configured (GAP-005).');
    }
    if (ctx.configuredFolders.length > 0 && !ctx.configuredFolders.includes(folder)) {
      return reject('AV-015', `Destination folder "${folder}" is not in the configured folder map.`);
    }
  }

  // 10. GAP-006 - hard delete is irreversible and requires its own explicit switch.
  if (item.actionType === 'DeleteEmail' && item.parameters.hardDelete === true && !safety.hardDeleteEnabled) {
    return reject('AV-016', 'Permanent deletion is not enabled; only a move to Deleted Items is permitted (GAP-006).');
  }

  return APPROVED;
}

export interface PlanValidationResult {
  readonly approved: readonly ActionPlanItem[];
  readonly rejected: readonly { readonly item: ActionPlanItem; readonly verdict: ActionVerdict }[];
}

/**
 * Validate a whole plan.
 *
 * A rejection does not silently drop one step and run the rest: a partially executed plan can leave
 * a message forwarded but not filed, or filed but not answered. The caller escalates the whole item.
 */
export function validatePlan(plan: readonly ActionPlanItem[], ctx: ValidationContext): PlanValidationResult {
  const approved: ActionPlanItem[] = [];
  const rejected: { item: ActionPlanItem; verdict: ActionVerdict }[] = [];

  for (const item of plan) {
    const verdict = validateAction(item, ctx);
    if (verdict.approved) approved.push(item);
    else rejected.push({ item, verdict });
  }

  return { approved, rejected };
}
