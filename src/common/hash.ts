import { createHash, randomUUID } from 'node:crypto';

/**
 * SHA-256 of the normalised body - the secondary idempotency key (FR-071).
 *
 * Normalising before hashing matters: the same message resent by a mail system can differ in
 * whitespace and line endings, and a hash that changes for those is useless as a duplicate key.
 */
export function bodyHash(normalisedBody: string): string {
  return createHash('sha256')
    .update(normalisedBody.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().toLowerCase())
    .digest('hex');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** BRD section 5 Flow 1 step 2: generate a unique processing ID. */
export function newProcessingId(): string {
  return randomUUID();
}

export function newCorrelationId(): string {
  return randomUUID();
}
