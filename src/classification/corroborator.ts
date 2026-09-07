/**
 * Deterministic corroboration of the model's classification (AD-006).
 *
 * This is what gives the BRD's medium confidence band ("restricted automation") a defined and
 * testable meaning. Independently of the model, it looks for configured evidence signals in the
 * email. Agreement lets a medium-band item proceed; disagreement demotes it to human review.
 *
 * It is a corroborator, never a classifier: it can only confirm or fail to confirm the model's
 * answer, and it never proposes a different scenario.
 */

import type { NormalisedEmail } from '../common/types.js';
import type { ScenarioConfig } from '../configuration/types.js';

export interface CorroborationResult {
  readonly corroborated: boolean;
  readonly matchedSignals: readonly string[];
  readonly competingScenarios: readonly string[];
}

function countSignals(scenario: ScenarioConfig, haystack: string): string[] {
  const matched: string[] = [];
  for (const keyword of scenario.keywords) {
    const needle = keyword.toLowerCase().trim();
    if (needle.length > 0 && haystack.includes(needle)) matched.push(keyword);
  }
  return matched;
}

export function corroborate(
  email: NormalisedEmail,
  chosen: ScenarioConfig,
  allScenarios: readonly ScenarioConfig[],
  minimumSignalMatches: number,
  /**
   * Scenarios the classifier already identified as secondary intents. Their signals are EXPECTED to
   * be present, so they are not treated as competing evidence - see below.
   */
  identifiedSecondaryScenarioIds: readonly string[] = [],
): CorroborationResult {
  const haystack = `${email.subject}\n${email.body}`.toLowerCase();
  const matchedSignals = countSignals(chosen, haystack);

  // Scenarios with materially more signal than the chosen one. Their presence does not overturn
  // the model, but it means the evidence is contested and a medium-band item should not auto-act.
  //
  // A scenario the classifier ALREADY declared as a secondary intent is excluded. On a genuine
  // multi-intent email the secondary intent legitimately carries signal - counting it as evidence
  // against the primary would fail corroboration on exactly the emails multi-intent handling exists
  // to serve.
  const expectedSecondary = new Set(identifiedSecondaryScenarioIds);
  const competingScenarios = allScenarios
    .filter((s) => s.scenarioId !== chosen.scenarioId && !expectedSecondary.has(s.scenarioId) && s.keywords.length > 0)
    .map((s) => ({ scenarioId: s.scenarioId, count: countSignals(s, haystack).length }))
    .filter((s) => s.count > matchedSignals.length)
    .map((s) => s.scenarioId);

  // A scenario with no configured keywords (SC-99) cannot be corroborated by signal, so signal
  // absence is not held against it.
  const signalBased = chosen.keywords.length === 0 || matchedSignals.length >= minimumSignalMatches;

  return {
    corroborated: signalBased && competingScenarios.length === 0,
    matchedSignals,
    competingScenarios,
  };
}
