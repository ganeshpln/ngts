/**
 * Confidence assessment and banding (BRD section 9, FR-022, FR-030, AD-005, AD-006).
 *
 * The model's self-reported confidence is an input, not a verdict: it is uncalibrated, and a model
 * under prompt injection will happily report 0.99. Penalties are applied for conditions that are
 * observably present, then the result is banded against the configured thresholds.
 *
 * Every threshold used here comes from configuration. There is no numeric literal in this module,
 * which is the mechanical form of Rule 3 and FR-030.
 */

import type { ActionType, ConfidenceAssessment, ConfidenceBand } from '../common/types.js';
import type { ScenarioConfig, ThresholdConfig } from '../configuration/types.js';

export interface ConfidenceInputs {
  readonly rawConfidence: number;
  readonly scenarioId: string;
  readonly bodyLength: number;
  readonly injectionSuspected: boolean;
  readonly languageDetected: string | null;
  readonly hasInvalidEntities: boolean;
  readonly corroborated: boolean;
  readonly corroboratingSignals: readonly string[];
}

const BAND_ORDER: Readonly<Record<ConfidenceBand, number>> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function bandFor(effectiveConfidence: number, high: number, medium: number): ConfidenceBand {
  if (effectiveConfidence >= high) return 'HIGH';
  if (effectiveConfidence >= medium) return 'MEDIUM';
  return 'LOW';
}

export function thresholdsFor(
  scenarioId: string,
  thresholds: ThresholdConfig,
  scenario?: ScenarioConfig,
): { high: number; medium: number } {
  const override = thresholds.confidence.scenarioOverrides?.[scenarioId];
  const high = override?.highThreshold ?? thresholds.confidence.highThreshold;
  const medium = override?.mediumThreshold ?? thresholds.confidence.mediumThreshold;

  // A per-scenario override on the scenario record itself raises the HIGH bar only - it can make a
  // scenario stricter, never more permissive.
  if (scenario?.confidenceThresholdOverride !== undefined && scenario.confidenceThresholdOverride !== null) {
    return { high: Math.max(high, scenario.confidenceThresholdOverride), medium };
  }
  return { high, medium };
}

export function assessConfidence(
  inputs: ConfidenceInputs,
  thresholds: ThresholdConfig,
  scenario?: ScenarioConfig,
): ConfidenceAssessment {
  const penalties = thresholds.penalties;
  const applied: string[] = [];
  let effective = inputs.rawConfidence;

  if (!inputs.corroborated) {
    effective *= penalties.noCorroboratingSignal;
    applied.push('noCorroboratingSignal');
  }
  if (inputs.bodyLength < thresholds.shortContentCharThreshold) {
    effective *= penalties.shortContent;
    applied.push('shortContent');
  }
  if (inputs.languageDetected !== null && !inputs.languageDetected.toLowerCase().startsWith('en')) {
    // GAP-016 / Q-19: language coverage is unconfirmed, so non-English content is penalised
    // rather than assumed to be handled as well as English.
    effective *= penalties.nonEnglishContent;
    applied.push('nonEnglishContent');
  }
  if (inputs.injectionSuspected) {
    effective *= penalties.injectionSuspected;
    applied.push('injectionSuspected');
  }
  if (inputs.hasInvalidEntities) {
    effective *= penalties.invalidEntityFormat;
    applied.push('invalidEntityFormat');
  }

  effective = Math.max(0, Math.min(1, effective));
  const { high, medium } = thresholdsFor(inputs.scenarioId, thresholds, scenario);

  return {
    rawConfidence: inputs.rawConfidence,
    effectiveConfidence: effective,
    band: bandFor(effective, high, medium),
    penaltiesApplied: applied,
    corroborated: inputs.corroborated,
    corroboratingSignals: inputs.corroboratingSignals,
  };
}

/**
 * AD-005: a destructive action needs the configured minimum band regardless of any per-scenario
 * override. Deletion is the only irreversible action in the approved set, so it does not get to
 * ride on a relaxed threshold.
 */
export function meetsBandForAction(
  action: ActionType,
  band: ConfidenceBand,
  thresholds: ThresholdConfig,
): boolean {
  if (!thresholds.confidence.destructiveActions.includes(action)) return true;
  return BAND_ORDER[band] >= BAND_ORDER[thresholds.confidence.destructiveActionMinimumBand];
}

/**
 * The medium band permits automation only when the deterministic layer independently agrees
 * (AD-006). Without this, "restricted automation" would have no operational meaning.
 */
export function mediumBandPermitsAutomation(
  assessment: ConfidenceAssessment,
  multiIntent: boolean,
  validatorAgrees: boolean | null,
  thresholds: ThresholdConfig,
): boolean {
  if (assessment.band !== 'MEDIUM') return assessment.band === 'HIGH';
  if (thresholds.corroboration.requiredForMediumBand && !assessment.corroborated) return false;
  if (multiIntent && thresholds.corroboration.requireValidatorAgreementForMultiIntent) {
    return validatorAgrees === true;
  }
  return true;
}
