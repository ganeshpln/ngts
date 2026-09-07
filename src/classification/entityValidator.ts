/**
 * Deterministic entity format validation.
 *
 * The model extracts; this module checks shape. A malformed GPID or email is not corrected - it is
 * flagged, because a "helpfully" corrected identifier is worse than a rejected one when the value
 * is used to identify a person in a change request.
 */

import type { ExtractedEntities } from '../common/types.js';

export interface EntityValidationResult {
  readonly valid: boolean;
  readonly invalidFields: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * GAP: the BRD does not state the GPID format. Accepts 6-12 digits, optionally with a
 * conventional prefix, and only warns on a mismatch so that an unexpected but genuine format is
 * not discarded.
 */
const GPID_PATTERN = /^[A-Za-z]{0,3}\s?\d{6,12}$/;
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function validateEntities(entities: ExtractedEntities): EntityValidationResult {
  const invalidFields: string[] = [];
  const warnings: string[] = [];

  if (entities.gpid !== null && !GPID_PATTERN.test(entities.gpid.trim())) {
    invalidFields.push('gpid');
    warnings.push('Extracted GPID does not match the expected format and has not been corrected.');
  }

  if (entities.email !== null && !EMAIL_PATTERN.test(entities.email.trim())) {
    invalidFields.push('email');
    warnings.push('Extracted email address is not well formed.');
  }

  if (entities.learnerName !== null && entities.learnerName.trim().length < 2) {
    invalidFields.push('learnerName');
  }

  return { valid: invalidFields.length === 0, invalidFields, warnings };
}

/**
 * Which entities a scenario needs before it can be actioned without a human (HIL-06).
 *
 * Deliberately narrow: only cases where acting without the value is plainly impossible. Requiring
 * more than this would push routine mail into the review queue and defeat the automation.
 */
const REQUIRED_ENTITIES: Readonly<Record<string, readonly (keyof ExtractedEntities)[]>> = {
  'SC-06': ['learnerName'], // cannot request a removal without identifying who
  'SC-12': ['email'], // cannot request an email change without the new address
};

export function findMissingRequiredEntities(scenarioId: string, entities: ExtractedEntities): readonly string[] {
  const required = REQUIRED_ENTITIES[scenarioId] ?? [];
  return required.filter((field) => {
    const value = entities[field];
    return value === null || value === undefined || String(value).trim().length === 0;
  });
}
