/**
 * The routing_decision_validator - prompt 5 (BRD section 11).
 *
 * A second opinion on a decision that has already been made, called for medium-band
 * classifications and for every multi-intent email (docs/ai-agent-design.md section 3).
 *
 * The asymmetry is the whole design:
 *
 *   - **Disagreement demotes.** The item goes to a human instead of being handled automatically.
 *   - **Agreement never promotes.** It cannot raise a confidence band, authorise a send, approve a
 *     deletion, or move an item past any gate it has already failed.
 *
 * So a false "disagree" costs a little human time, and a false "agree" changes nothing that was not
 * already permitted. That is why the validator is allowed to be a model call at all: the worst it
 * can do is send work to a person.
 *
 * A validator that cannot be reached is treated as "not consulted", which fails safe - a
 * medium-band multi-intent email then has no agreement to rely on and escalates.
 */

import { extractJsonObject, MAX_REASONING_SUMMARY_CHARS } from './schemaValidator.js';
import type { ModelClient } from './modelClient.js';
import { PromptLoader, buildValidatorUserMessage, type ValidatorPromptContext } from './promptBuilder.js';
import { err, ok, type Result } from '../common/result.js';
import type { Logger } from '../common/logger.js';

export interface ValidatorVerdict {
  readonly agrees: boolean;
  readonly confidence: number;
  /** Why the validator disagrees. Shown to the human reviewer; length-capped (Rule 11). */
  readonly concern: string | null;
  /** Advisory only - never changes routing on its own. */
  readonly suggestedScenarioId: string | null;
  readonly injectionSuspected: boolean;
  readonly promptVersion: string;
  readonly latencyMs: number;
}

export interface ValidatorViolation {
  readonly path: string;
  readonly message: string;
}

const VALID_SCENARIOS = new Set([
  'SC-01', 'SC-02', 'SC-03', 'SC-04', 'SC-05', 'SC-06',
  'SC-07', 'SC-08', 'SC-09', 'SC-10', 'SC-11', 'SC-12', 'SC-99',
]);

/**
 * Parse and validate the verdict.
 *
 * Anything malformed is rejected rather than coerced. In particular a missing or non-boolean
 * `agrees` is NOT read as agreement - the caller treats a rejected verdict as "not consulted", so
 * an unparseable response can never be mistaken for approval.
 */
export function parseValidatorVerdict(
  raw: unknown,
  promptVersion: string,
  latencyMs: number,
): Result<ValidatorVerdict, readonly ValidatorViolation[]> {
  const violations: ValidatorViolation[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return err([{ path: '', message: 'validator output is not a JSON object' }]);
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.agrees !== 'boolean') {
    violations.push({ path: 'agrees', message: 'must be a boolean' });
  }

  const confidence = o.confidence;
  if (confidence !== undefined && confidence !== null) {
    if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
      violations.push({ path: 'confidence', message: 'must be a number between 0 and 1' });
    }
  }

  const concern = o.concern;
  if (concern !== undefined && concern !== null) {
    if (typeof concern !== 'string') {
      violations.push({ path: 'concern', message: 'must be a string or null' });
    } else if (concern.length > MAX_REASONING_SUMMARY_CHARS) {
      // Rule 11: the concern field must not become a channel for deliberation.
      violations.push({
        path: 'concern',
        message: `exceeds ${MAX_REASONING_SUMMARY_CHARS} characters, which suggests reasoning disclosure`,
      });
    }
  }

  const suggested = o.suggestedScenarioId;
  if (suggested !== undefined && suggested !== null) {
    if (typeof suggested !== 'string' || !VALID_SCENARIOS.has(suggested)) {
      violations.push({ path: 'suggestedScenarioId', message: 'is not a known scenario identifier' });
    }
  }

  if (violations.length > 0) return err(violations);

  return ok({
    agrees: o.agrees as boolean,
    confidence: typeof confidence === 'number' ? confidence : 0,
    concern: typeof concern === 'string' && concern.length > 0 ? concern : null,
    suggestedScenarioId: typeof suggested === 'string' ? suggested : null,
    injectionSuspected: o.injectionSuspected === true,
    promptVersion,
    latencyMs,
  });
}

export interface ConsultOptions {
  readonly model: ModelClient;
  readonly promptLoader: PromptLoader;
  readonly promptFile: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly logger: Logger;
  readonly context: ValidatorPromptContext;
}

/**
 * Call the validator. Returns `null` for "not consulted" - a failed call, an unparseable response,
 * or a missing prompt. Never throws: a validator problem must not stop an email being processed,
 * it must only withhold the agreement that would have allowed automation.
 */
export async function consultRoutingValidator(options: ConsultOptions): Promise<ValidatorVerdict | null> {
  try {
    const prompt = await options.promptLoader.load(options.promptFile);

    const response = await options.model.complete({
      systemPrompt: prompt.systemPrompt,
      userMessage: buildValidatorUserMessage(options.context),
      promptName: prompt.name,
      promptVersion: prompt.version,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });

    if (!response.ok) {
      options.logger.warn('Routing validator was not reached; proceeding without agreement', {
        stage: 'Classify',
        errorCode: response.error.code,
        promptVersion: prompt.version,
      });
      return null;
    }

    const parsed = parseValidatorVerdict(
      extractJsonObject(response.value.content),
      prompt.version,
      response.value.latencyMs,
    );

    if (!parsed.ok) {
      options.logger.warn('Routing validator returned an unusable verdict; proceeding without agreement', {
        stage: 'Classify',
        promptVersion: prompt.version,
        errorCode: 'VALIDATOR_SCHEMA_INVALID',
      });
      return null;
    }

    return parsed.value;
  } catch (error) {
    options.logger.warn('Routing validator call failed; proceeding without agreement', {
      stage: 'Classify',
      errorCode: error instanceof Error ? error.name : 'Unknown',
    });
    return null;
  }
}

/**
 * Whether the validator is worth calling for this item.
 *
 * It is skipped when the outcome cannot change - a LOW-band item is already going to a human, so a
 * second opinion would cost a model call and change nothing.
 */
export function shouldConsultValidator(
  band: 'HIGH' | 'MEDIUM' | 'LOW',
  multiIntent: boolean,
  settings: { readonly onMediumBand: boolean; readonly onMultiIntent: boolean },
): boolean {
  if (band === 'LOW') return false;
  if (band === 'MEDIUM' && settings.onMediumBand) return true;
  if (multiIntent && settings.onMultiIntent) return true;
  return false;
}
