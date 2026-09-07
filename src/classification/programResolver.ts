/**
 * FIT / FLO / MEC programme determination (BRD section 8, FR-026 to FR-028, AD-004).
 *
 * A weighted evidence model, not a keyword lookup. The decisive property is FR-028: the programme
 * is left UNKNOWN unless the evidence supports it, because the BRD has an explicit rule for
 * unknown - Rule R-1, route to BOTH owners - and that rule is safer than a guess.
 *
 * Pure function of (classification, scenario, config). No I/O, which is what makes the whole
 * programme matrix exhaustively testable.
 */

import type { Classification, Program, ProgramResolution } from '../common/types.js';
import type { ScenarioConfig, ThresholdConfig } from '../configuration/types.js';

export function resolveProgram(
  classification: Classification,
  scenario: ScenarioConfig,
  thresholds: ThresholdConfig,
): ProgramResolution {
  const { weights, programConfidenceThreshold, genericKeywordOnlyCeiling } = thresholds.programEvidence;
  const evidence = classification.programEvidence ?? [];
  const proposed = classification.program;

  // Business rule first: a scenario scoped to a single programme determines it outright, with no
  // inference required. SC-07 (Schoox/MEC) is MEC_CGR by definition.
  if (scenario.programScope === 'MEC_CGR') {
    return {
      program: 'MEC_CGR',
      score: weights.businessRule ?? 0.8,
      resolvedBy: 'businessRule',
      appliedFallbackRule: false,
      conflicting: false,
    };
  }

  // A scenario that is not programme-scoped at all does not need one.
  if (scenario.programScope === 'ANY' && !scenario.requiresProgram) {
    return {
      program: proposed === 'UNKNOWN' ? 'ALL' : proposed,
      score: 1,
      resolvedBy: 'businessRule',
      appliedFallbackRule: false,
      conflicting: false,
    };
  }

  const conflicting = evidence.filter((e) => e.source === 'explicitProgramMention').length > 1 && proposed === 'UNKNOWN';
  if (conflicting) {
    // Both programmes named explicitly. Never pick one - Rule R-1 sends it to both owners.
    return { program: 'UNKNOWN', score: 0, resolvedBy: 'conflict', appliedFallbackRule: true, conflicting: true };
  }

  // Aggregate the evidence. Strongest single source rather than a sum: an explicit mention is
  // decisive on its own, and five weak signals should not add up to look like one strong one.
  let score = 0;
  let onlyGenericKeywords = evidence.length > 0;
  for (const e of evidence) {
    const weight = weights[e.source] ?? 0;
    if (weight > score) score = weight;
    if (e.source !== 'genericKeyword') onlyGenericKeywords = false;
  }

  // FR-028, enforced structurally: generic keywords alone can never reach the threshold.
  if (onlyGenericKeywords) score = Math.min(score, genericKeywordOnlyCeiling);

  const isConcreteProgram = proposed === 'FIT' || proposed === 'FLO';

  if (isConcreteProgram && score >= programConfidenceThreshold) {
    const explicit = evidence.some((e) => e.source === 'explicitProgramMention');
    return {
      program: proposed as Program,
      score,
      resolvedBy: explicit ? 'explicit' : 'evidence',
      appliedFallbackRule: false,
      conflicting: false,
    };
  }

  // Rule R-1 (FR-027, BRD section 8, explicit): "If FIT/FLO is not mentioned in the email, send the
  // email to both Josh and Jordon." Applied here as UNKNOWN; the routing resolver turns UNKNOWN
  // into the two-owner destination.
  return {
    program: 'UNKNOWN',
    score,
    resolvedBy: 'fallback',
    appliedFallbackRule: true,
    conflicting: false,
  };
}
