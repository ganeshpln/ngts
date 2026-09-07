/**
 * Startup configuration validation.
 *
 * The system fails closed: a configuration that would let it misbehave stops the service rather
 * than being silently tolerated. Acting on rules that do not hold together is worse than not
 * acting (see docs/integration-design.md section 9).
 */

import { ACTION_TYPES, type ActionType } from '../common/types.js';
import type { ConfigurationStore } from './types.js';

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly subject: string;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

const DELETE_PERMITTED_SCENARIOS = new Set(['SC-08']); // BRD section 6 Scenario 8 only (Rule 15).

export async function validateConfiguration(store: ConfigurationStore): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const error = (code: string, subject: string, message: string) =>
    issues.push({ severity: 'error', code, subject, message });
  const warn = (code: string, subject: string, message: string) =>
    issues.push({ severity: 'warning', code, subject, message });

  const [scenarios, rules, templates, thresholds, flags, safety, regions, reporting] = await Promise.all([
    store.getScenarios(),
    store.getRoutingRules(),
    store.getTemplates(),
    store.getThresholds(),
    store.getFeatureFlags(),
    store.getSafetyConfig(),
    store.getRegionMappings(),
    store.getReportingConfig(),
  ]);

  const scenarioIds = new Set(scenarios.map((s) => s.scenarioId));
  const templateIds = new Map(templates.map((t) => [t.templateId, t]));
  const validActions = new Set<string>(ACTION_TYPES);

  // --- Scenarios -----------------------------------------------------------
  for (const s of scenarios) {
    for (const a of s.allowedActions) {
      if (!validActions.has(a)) {
        error('CFG-001', s.scenarioId, `Allowed action "${a}" is not in the approved action set (FR-031).`);
      }
    }
    if (s.deleteAllowed && !DELETE_PERMITTED_SCENARIOS.has(s.scenarioId)) {
      error('CFG-002', s.scenarioId, 'deleteAllowed is true but the BRD permits deletion only for SC-08 (Rule 15).');
    }
    if (s.deleteAllowed && !s.allowedActions.includes('DeleteEmail' as ActionType)) {
      error('CFG-003', s.scenarioId, 'deleteAllowed is true but DeleteEmail is not in allowedActions.');
    }
    if (s.sendResponseAllowed && !s.allowedActions.includes('SendResponse' as ActionType)) {
      error('CFG-004', s.scenarioId, 'sendResponseAllowed is true but SendResponse is not in allowedActions.');
    }
    const override = s.confidenceThresholdOverride;
    if (override !== undefined && override !== null && (override < 0 || override > 1)) {
      error('CFG-005', s.scenarioId, 'confidenceThresholdOverride must be between 0 and 1.');
    }
  }

  // --- Routing rules -------------------------------------------------------
  for (const r of rules) {
    if (!scenarioIds.has(r.scenarioId)) {
      error('CFG-010', r.ruleId, `Routing rule references unknown or inactive scenario "${r.scenarioId}".`);
      continue;
    }
    const scenario = scenarios.find((s) => s.scenarioId === r.scenarioId)!;

    for (const a of r.actionPlan) {
      if (!validActions.has(a)) {
        error('CFG-011', r.ruleId, `Action plan contains "${a}", which is not an approved action.`);
      } else if (!scenario.allowedActions.includes(a)) {
        error('CFG-012', r.ruleId, `Action "${a}" is not in the allowed action set for ${r.scenarioId}.`);
      }
    }
    if (r.actionPlan.includes('SendResponse' as ActionType) && !scenario.sendResponseAllowed) {
      error('CFG-013', r.ruleId, `Plan sends a response but ${r.scenarioId} does not permit sending (Rule 14).`);
    }
    if (r.actionPlan.includes('DeleteEmail' as ActionType) && !scenario.deleteAllowed) {
      error('CFG-014', r.ruleId, `Plan deletes but ${r.scenarioId} does not permit deletion (Rule 15).`);
    }
    if (r.actionPlan.includes('SendResponse' as ActionType) && !r.responseTemplateId) {
      error('CFG-015', r.ruleId, 'Plan sends a response but no responseTemplateId is configured.');
    }
    if (r.responseTemplateId) {
      const tpl = templateIds.get(r.responseTemplateId);
      if (!tpl) {
        error('CFG-016', r.ruleId, `References template "${r.responseTemplateId}", which does not exist.`);
      } else if (tpl.scenarioId !== r.scenarioId) {
        error('CFG-017', r.ruleId, `Template "${tpl.templateId}" belongs to ${tpl.scenarioId}, not ${r.scenarioId}.`);
      } else if (!tpl.isActive) {
        // Not fatal while sending is disabled: this is the expected state under GAP-004.
        const msg = `Template "${tpl.templateId}" is inactive, so a response cannot be sent (GAP-004).`;
        if (flags.sendResponsesEnabled) error('CFG-018', r.ruleId, msg);
        else warn('CFG-018', r.ruleId, msg);
      }
    }
    if (
      (r.routingTarget === 'PROGRAM_OWNER' || r.routingTarget === 'SCHOOX_OWNER') &&
      r.ownerEmails.length === 0
    ) {
      error('CFG-019', r.ruleId, `Routing target ${r.routingTarget} has no owner address configured (Rule 16).`);
    }
    if (r.routingTarget === 'CHANGE_REQUEST' && r.ownerEmails.length === 0) {
      const msg = 'Change-request routing has no destination configured (GAP-003).';
      if (flags.changeRequestRoutingEnabled) error('CFG-020', r.ruleId, msg);
      else warn('CFG-020', r.ruleId, msg);
    }
    if (r.actionPlan.includes('MoveEmail' as ActionType) && !r.destinationFolder) {
      warn('CFG-021', r.ruleId, 'Plan moves the message but no destination folder is configured (GAP-005).');
    }
  }

  // --- Coverage ------------------------------------------------------------
  for (const s of scenarios) {
    if (!rules.some((r) => r.scenarioId === s.scenarioId)) {
      error('CFG-030', s.scenarioId, 'Scenario has no routing rule; classified mail would have nowhere to go.');
    }
    if (s.programScope === 'FIT_FLO') {
      for (const program of ['FIT', 'FLO', 'UNKNOWN']) {
        if (!rules.some((r) => r.scenarioId === s.scenarioId && r.program === program)) {
          // UNKNOWN missing is the serious one: it is the BRD's explicit fallback (FR-027).
          error('CFG-031', s.scenarioId, `No routing rule for programme ${program}.`);
        }
      }
    }
  }

  // --- Thresholds ----------------------------------------------------------
  const { highThreshold, mediumThreshold } = thresholds.confidence;
  if (!(highThreshold > mediumThreshold)) {
    error('CFG-040', 'thresholds', 'highThreshold must be greater than mediumThreshold.');
  }
  for (const [name, value] of [['highThreshold', highThreshold], ['mediumThreshold', mediumThreshold]] as const) {
    if (value < 0 || value > 1) error('CFG-041', 'thresholds', `${name} must be between 0 and 1.`);
  }
  for (const [sid, o] of Object.entries(thresholds.confidence.scenarioOverrides ?? {})) {
    if (sid.startsWith('$')) continue;
    if (!scenarioIds.has(sid)) warn('CFG-042', sid, 'Threshold override for an unknown scenario.');
    if (o.highThreshold <= o.mediumThreshold) error('CFG-043', sid, 'Override highThreshold must exceed mediumThreshold.');
  }
  for (const [name, value] of Object.entries(thresholds.penalties)) {
    if (value <= 0 || value > 1) error('CFG-044', 'penalties', `Penalty "${name}" must be in (0, 1].`);
  }

  // --- Safety --------------------------------------------------------------
  if (safety.allowedRecipientDomains.length === 0) {
    error('CFG-050', 'safety', 'allowedRecipientDomains is empty; no outbound recipient could be validated.');
  }
  if (safety.botIdentities.length === 0) {
    warn('CFG-051', 'safety', 'botIdentities is empty (GAP-013); loop prevention relies on header detection alone.');
  }
  if (safety.hardDeleteEnabled) {
    warn('CFG-052', 'safety', 'Hard delete is enabled - deletions are irreversible (GAP-006).');
  }
  if (safety.maxOutboundPerConversation < 1) {
    error('CFG-053', 'safety', 'maxOutboundPerConversation must be at least 1.');
  }

  // --- Known open gaps (reported every startup so they stay visible) --------
  if (regions.length === 0) {
    warn('CFG-060', 'regionMapping', 'Region mapping is empty (GAP-012); all reporting aggregates to UNMAPPED.');
  }
  if (reporting.recipients.length === 0) {
    warn('CFG-061', 'reporting', 'No Friday report recipients configured (GAP-014); the report will not be sent.');
  }
  if (flags.shadowMode) {
    warn('CFG-062', 'features', 'Shadow mode is ON - decisions are audited but no mailbox action is executed.');
  }

  return { valid: !issues.some((i) => i.severity === 'error'), issues };
}
