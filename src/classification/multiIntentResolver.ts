/**
 * Multi-intent resolution (BRD section 7, FR-024, FR-025, AD-003).
 *
 * The BRD mandates the capability and states one hard rule - "do not blindly select the first
 * keyword" - but leaves the resolution policy open. The policy below is configuration
 * (routing-rules.json -> multiIntent), so Business can change precedence without a deployment.
 *
 * The bias throughout is towards human review: where two intents would send an email to two
 * different teams and there is no BRD precedence, a human decides.
 */

import type { Classification, MultiIntentResolution, SubIntent } from '../common/types.js';
import type { MultiIntentConfig, ScenarioConfig } from '../configuration/types.js';

export interface MultiIntentInput {
  readonly classification: Classification;
  readonly scenarios: readonly ScenarioConfig[];
  readonly config: MultiIntentConfig;
  /** Header evidence that the message is machine generated (feeds MI-CRFORM-WINS). */
  readonly machineGenerated: boolean;
  /** Sub-intents resolved per scenario, primary first. */
  readonly subIntents: ReadonlyMap<string, SubIntent>;
}

const SINGLE = (scenarioId: string, rule: string | null): MultiIntentResolution => ({
  multiIntent: false,
  primaryScenarioId: scenarioId,
  additionalScenarioIds: [],
  ruleApplied: rule,
  requiresHumanReview: false,
  reason: null,
});

const REVIEW = (scenarioId: string, additional: readonly string[], rule: string, reason: string): MultiIntentResolution => ({
  multiIntent: true,
  primaryScenarioId: scenarioId,
  additionalScenarioIds: additional,
  ruleApplied: rule,
  requiresHumanReview: true,
  reason,
});

/** Scenarios that carry no actionable request of their own. */
const NON_ACTIONABLE = new Set(['SC-04', 'SC-08', 'SC-11']);

export function resolveMultiIntent(input: MultiIntentInput): MultiIntentResolution {
  const { classification, config, machineGenerated, subIntents } = input;
  const primary = classification.scenarioId;

  const secondary = (classification.secondaryIntents ?? [])
    .map((s) => s.scenarioId)
    .filter((id) => id !== primary && id !== 'SC-99');
  const all = [primary, ...secondary];

  if (secondary.length === 0) return SINGLE(primary, null);

  // MI-AUTOREPLY-WINS - an auto-reply carries no actionable content, whatever else it quotes.
  if (all.includes('SC-08')) return SINGLE('SC-08', 'MI-AUTOREPLY-WINS');

  // MI-CRFORM-WINS - a machine-generated change-request form notification is exactly that.
  if (all.includes('SC-04') && machineGenerated) return SINGLE('SC-04', 'MI-CRFORM-WINS');

  // MI-RESOLVED-PLUS - "thanks, but I still cannot..." must not silently close an open issue.
  if (all.includes('SC-11') && all.some((id) => !NON_ACTIONABLE.has(id))) {
    return REVIEW(
      all.find((id) => !NON_ACTIONABLE.has(id)) ?? primary,
      all.filter((id) => id !== primary),
      'MI-RESOLVED-PLUS',
      'The email both confirms resolution and raises an outstanding issue.',
    );
  }

  const actionable = all.filter((id) => !NON_ACTIONABLE.has(id));

  // MI-THREE-OR-MORE - beyond two actionable intents there is no safe automatic reading.
  if (new Set(actionable).size >= 3) {
    return REVIEW(primary, secondary, 'MI-THREE-OR-MORE', 'Three or more distinct actionable intents were identified.');
  }

  // MI-CR-VS-TECH - contradictory destinations, and the BRD gives no precedence between them.
  const observed = new Set(actionable.map((id) => subIntents.get(id) ?? null));
  if (observed.has('change_request') && observed.has('technical')) {
    return REVIEW(
      primary,
      secondary,
      'MI-CR-VS-TECH',
      'The email mixes a change request with a technical fault, which route to different teams.',
    );
  }

  // MI-SCHOOX-PLUS - BRD section 6 Scenario 7 (Rule R-2): the Schoox owner always takes it, and the
  // FIT/FLO owner is involved only because a SEPARATE FIT/FLO issue is present. Both routes run.
  if (all.includes('SC-07')) {
    const others = all.filter((id) => id !== 'SC-07' && !NON_ACTIONABLE.has(id));
    if (others.length > 0) {
      return {
        multiIntent: true,
        primaryScenarioId: 'SC-07',
        additionalScenarioIds: others,
        ruleApplied: 'MI-SCHOOX-PLUS',
        requiresHumanReview: false,
        reason: null,
      };
    }
    return SINGLE('SC-07', 'MI-SCHOOX-PLUS');
  }

  // Fall through: two actionable intents with no special rule. Precedence decides the primary -
  // never keyword order (BRD section 7 point 1).
  const ranked = [...actionable].sort((a, b) => {
    const ia = config.precedence.indexOf(a);
    const ib = config.precedence.indexOf(b);
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
  });
  const primaryByPrecedence = ranked[0] ?? primary;

  return {
    multiIntent: true,
    primaryScenarioId: primaryByPrecedence,
    additionalScenarioIds: ranked.slice(1),
    ruleApplied: 'MI-PRECEDENCE',
    requiresHumanReview: false,
    reason: null,
  };
}
