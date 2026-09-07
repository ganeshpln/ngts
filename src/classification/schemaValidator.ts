/**
 * Validation of the model's structured output (FR-020, FR-021, AD-020).
 *
 * This is the contract boundary between the AI and the deterministic control layer. Anything that
 * does not conform is rejected outright - there is no partial parsing, no coercion of a nearly
 * right value, and no "best effort" reading of malformed JSON. A rejected output means human
 * review (HIL-05), which is a safe outcome; a coerced one is a silent wrong answer.
 *
 * The authoritative schema is config/schemas/classification.schema.json; this validator implements
 * it directly so the service carries no runtime schema-compiler dependency, and the two are kept in
 * step by tests/unit/schemaValidator.test.ts.
 */

import {
  isProgram,
  isSenderType,
  type Classification,
  type ExtractedEntities,
  type ProgramEvidence,
  type ProgramEvidenceSource,
  type SecondaryIntent,
  type SubIntent,
} from '../common/types.js';
import { err, ok, type Result } from '../common/result.js';

export interface SchemaViolation {
  readonly path: string;
  readonly message: string;
}

const VALID_SCENARIOS = new Set([
  'SC-01', 'SC-02', 'SC-03', 'SC-04', 'SC-05', 'SC-06',
  'SC-07', 'SC-08', 'SC-09', 'SC-10', 'SC-11', 'SC-12', 'SC-99',
]);

const VALID_EVIDENCE_SOURCES = new Set<string>([
  'explicitProgramMention', 'businessRule', 'programSpecificVocabulary',
  'threadHistory', 'senderHistory', 'genericKeyword',
]);

const VALID_ACTIONS = new Set([
  'SendResponse', 'ForwardEmail', 'MoveEmail', 'MarkAsRead', 'DeleteEmail',
  'RouteToChangeRequest', 'RouteToProgramOwner', 'EscalateToHumanReview', 'GenerateReport',
]);

const ENTITY_FIELDS = ['learnerName', 'gpid', 'email', 'program', 'island', 'week', 'errorMessage'] as const;

const ENTITY_MAX_LENGTHS: Readonly<Record<(typeof ENTITY_FIELDS)[number], number>> = {
  learnerName: 200, gpid: 50, email: 320, program: 50, island: 100, week: 50, errorMessage: 1000,
};

/** Rule 11: the reasoning summary is capped so a model cannot leak deliberation through it. */
export const MAX_REASONING_SUMMARY_CHARS = 600;

function optionalString(value: unknown, path: string, maxLength: number, violations: SchemaViolation[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    violations.push({ path, message: 'must be a string or null' });
    return null;
  }
  if (value.length > maxLength) {
    violations.push({ path, message: `exceeds maximum length of ${maxLength}` });
    return null;
  }
  return value.length === 0 ? null : value;
}

function parseEntities(raw: unknown, violations: SchemaViolation[]): ExtractedEntities {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (raw !== undefined && raw !== null && typeof raw !== 'object') {
    violations.push({ path: 'extractedEntities', message: 'must be an object' });
  }
  const out: Record<string, string | null> = {};
  for (const field of ENTITY_FIELDS) {
    out[field] = optionalString(source[field], `extractedEntities.${field}`, ENTITY_MAX_LENGTHS[field], violations);
  }
  return out as unknown as ExtractedEntities;
}

function parseSecondaryIntents(raw: unknown, violations: SchemaViolation[]): readonly SecondaryIntent[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    violations.push({ path: 'secondaryIntents', message: 'must be an array' });
    return [];
  }
  if (raw.length > 5) violations.push({ path: 'secondaryIntents', message: 'exceeds maximum of 5 items' });

  const out: SecondaryIntent[] = [];
  raw.slice(0, 5).forEach((item, i) => {
    const o = item as Record<string, unknown>;
    const scenarioId = o?.scenarioId;
    const confidence = o?.confidence;
    if (typeof scenarioId !== 'string' || !VALID_SCENARIOS.has(scenarioId)) {
      violations.push({ path: `secondaryIntents[${i}].scenarioId`, message: 'is not a known scenario identifier' });
      return;
    }
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      violations.push({ path: `secondaryIntents[${i}].confidence`, message: 'must be a number between 0 and 1' });
      return;
    }
    const subIntent = o?.subIntent;
    const parsedSubIntent: SubIntent =
      subIntent === 'change_request' || subIntent === 'technical' ? subIntent : null;
    out.push({ scenarioId, confidence, subIntent: parsedSubIntent });
  });
  return out;
}

function parseProgramEvidence(raw: unknown, violations: SchemaViolation[]): readonly ProgramEvidence[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    violations.push({ path: 'programEvidence', message: 'must be an array' });
    return [];
  }
  const out: ProgramEvidence[] = [];
  raw.slice(0, 10).forEach((item, i) => {
    const source = (item as Record<string, unknown>)?.source;
    if (typeof source !== 'string' || !VALID_EVIDENCE_SOURCES.has(source)) {
      violations.push({ path: `programEvidence[${i}].source`, message: 'is not a recognised evidence source' });
      return;
    }
    const detail = (item as Record<string, unknown>)?.detail;
    out.push({
      source: source as ProgramEvidenceSource,
      detail: typeof detail === 'string' ? detail.slice(0, 300) : undefined,
    });
  });
  return out;
}

/**
 * Validate and normalise raw model output.
 *
 * On success the returned Classification is safe to reason about - but note that its routing and
 * action fields are still ADVISORY ONLY. Passing validation does not make the model's proposed
 * destination usable; the deterministic layer resolves that separately (Rules 12 and 16).
 */
export function validateClassification(raw: unknown): Result<Classification, readonly SchemaViolation[]> {
  const violations: SchemaViolation[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return err([{ path: '', message: 'output is not a JSON object' }]);
  }
  const o = raw as Record<string, unknown>;

  const scenarioId = o.scenarioId;
  if (typeof scenarioId !== 'string' || !VALID_SCENARIOS.has(scenarioId)) {
    violations.push({ path: 'scenarioId', message: 'must be one of the defined scenario identifiers' });
  }

  const program = o.program;
  if (!isProgram(program)) {
    violations.push({ path: 'program', message: 'must be FIT, FLO, MEC_CGR, ALL or UNKNOWN' });
  }

  const confidence = o.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    violations.push({ path: 'confidence', message: 'must be a number between 0 and 1' });
  }

  const senderType = o.senderType;
  if (!isSenderType(senderType)) {
    violations.push({ path: 'senderType', message: 'is not a recognised sender type' });
  }

  const intent = o.intent;
  if (typeof intent !== 'string' || intent.length === 0 || intent.length > 200) {
    violations.push({ path: 'intent', message: 'must be a non-empty string of at most 200 characters' });
  }

  if (typeof o.requiresHumanReview !== 'boolean') {
    violations.push({ path: 'requiresHumanReview', message: 'must be a boolean' });
  }

  const reasoningSummary = o.reasoningSummary;
  if (typeof reasoningSummary !== 'string') {
    violations.push({ path: 'reasoningSummary', message: 'must be a string' });
  } else if (reasoningSummary.length > MAX_REASONING_SUMMARY_CHARS) {
    // Rule 11 - an over-long summary is treated as a contract breach, not truncated silently.
    violations.push({
      path: 'reasoningSummary',
      message: `exceeds ${MAX_REASONING_SUMMARY_CHARS} characters, which suggests reasoning disclosure`,
    });
  }

  const subIntentRaw = o.subIntent;
  if (subIntentRaw !== undefined && subIntentRaw !== null && subIntentRaw !== 'change_request' && subIntentRaw !== 'technical') {
    violations.push({ path: 'subIntent', message: 'must be change_request, technical or null' });
  }

  const recommendedAction = o.recommendedAction;
  if (
    recommendedAction !== undefined &&
    recommendedAction !== null &&
    (typeof recommendedAction !== 'string' || !VALID_ACTIONS.has(recommendedAction))
  ) {
    // Threat T-15: a model naming an action outside the approved set is a contract breach.
    violations.push({ path: 'recommendedAction', message: 'is not in the approved action set' });
  }

  const entities = parseEntities(o.extractedEntities, violations);
  const secondaryIntents = parseSecondaryIntents(o.secondaryIntents, violations);
  const programEvidence = parseProgramEvidence(o.programEvidence, violations);

  if (violations.length > 0) return err(violations);

  return ok({
    processingId: typeof o.processingId === 'string' ? o.processingId : undefined,
    scenarioId: scenarioId as string,
    scenarioName: typeof o.scenarioName === 'string' ? o.scenarioName.slice(0, 200) : undefined,
    program: program as Classification['program'],
    programEvidence,
    intent: intent as string,
    subIntent: (subIntentRaw ?? null) as SubIntent,
    confidence: confidence as number,
    senderType: senderType as Classification['senderType'],
    requiresHumanReview: o.requiresHumanReview as boolean,
    multiIntent: o.multiIntent === true || secondaryIntents.length > 0,
    secondaryIntents,
    extractedEntities: entities,
    missingRequiredInformation: Array.isArray(o.missingRequiredInformation)
      ? (o.missingRequiredInformation as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 10)
      : [],
    // Advisory only - recorded for audit, discarded from the decision path (Rules 12 and 16).
    recommendedAction: (recommendedAction ?? null) as Classification['recommendedAction'],
    routingOwner: typeof o.routingOwner === 'string' ? o.routingOwner.slice(0, 200) : null,
    routingEmail: typeof o.routingEmail === 'string' ? o.routingEmail.slice(0, 1000) : null,
    destinationFolder: typeof o.destinationFolder === 'string' ? o.destinationFolder.slice(0, 200) : null,
    responseTemplateId: typeof o.responseTemplateId === 'string' ? o.responseTemplateId.slice(0, 50) : null,
    reasoningSummary: reasoningSummary as string,
    injectionSuspected: o.injectionSuspected === true,
    languageDetected: typeof o.languageDetected === 'string' ? o.languageDetected.slice(0, 20) : null,
  });
}

/** Best-effort extraction of a JSON object from model output that wrapped it in prose or fences. */
export function extractJsonObject(text: string): unknown {
  const trimmed = (text ?? '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
