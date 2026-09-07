/**
 * Idempotency (FR-070 to FR-072, BRD section 15).
 *
 * Two keys. `internetMessageId` is primary: it is globally unique per RFC 5322 and, crucially,
 * survives a folder move - unlike the Graph message id, which changes when a message is moved.
 * `bodyHash + sender + subject` is secondary, catching a resend that carries a fresh message id.
 *
 * The claim is a CONDITIONAL INSERT performed BEFORE any side effect, so Power Automate's
 * at-least-once retry semantics cannot produce a duplicate send. A read-then-write check would
 * race; a uniqueness violation cannot.
 */

import type { NormalisedEmail } from '../common/types.js';

export type ProcessingStatus =
  | 'Claimed'
  | 'Classifying'
  | 'Decided'
  | 'Executing'
  | 'Completed'
  | 'Failed'
  | 'HumanReview'
  | 'Suppressed'
  | 'Duplicate';

export interface ProcessingRecord {
  readonly processingId: string;
  readonly internetMessageId: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly bodyHash: string;
  readonly senderEmail: string;
  readonly subject: string;
  readonly status: ProcessingStatus;
  readonly retryCount: number;
  readonly createdDate: string;
}

export type ClaimOutcome =
  | { readonly kind: 'claimed'; readonly record: ProcessingRecord }
  | { readonly kind: 'duplicate'; readonly existing: ProcessingRecord; readonly matchedOn: 'internetMessageId' | 'secondaryKey' }
  | { readonly kind: 'resumable'; readonly existing: ProcessingRecord };

/**
 * Persistence port. The Dataverse implementation relies on an alternate key on
 * `spa_internetmessageid` so that a concurrent claim fails at the platform, not in application code.
 */
export interface ProcessingStore {
  /** Atomic conditional insert. Returns null when the key is already taken. */
  tryClaim(record: ProcessingRecord): Promise<ProcessingRecord | null>;
  findByInternetMessageId(internetMessageId: string): Promise<ProcessingRecord | null>;
  findBySecondaryKey(bodyHash: string, senderEmail: string, subject: string): Promise<ProcessingRecord | null>;
  updateStatus(processingId: string, status: ProcessingStatus): Promise<void>;
  countOutboundForConversation(conversationId: string): Promise<number>;
}

/** Only these states may be re-entered by a replay; every other state short-circuits (FR-072). */
const RESUMABLE: ReadonlySet<ProcessingStatus> = new Set<ProcessingStatus>(['Claimed', 'Failed']);

export function secondaryKeyOf(email: NormalisedEmail): { bodyHash: string; senderEmail: string; subject: string } {
  return { bodyHash: email.bodyHash, senderEmail: email.senderEmail, subject: email.subject };
}

export async function claimForProcessing(
  store: ProcessingStore,
  email: NormalisedEmail,
  processingId: string,
  now: Date,
): Promise<ClaimOutcome> {
  const existing = await store.findByInternetMessageId(email.internetMessageId);
  if (existing) {
    return RESUMABLE.has(existing.status)
      ? { kind: 'resumable', existing }
      : { kind: 'duplicate', existing, matchedOn: 'internetMessageId' };
  }

  const record: ProcessingRecord = {
    processingId,
    internetMessageId: email.internetMessageId,
    messageId: email.messageId,
    conversationId: email.conversationId,
    bodyHash: email.bodyHash,
    senderEmail: email.senderEmail,
    subject: email.subject,
    status: 'Claimed',
    retryCount: 0,
    createdDate: now.toISOString(),
  };

  const claimed = await store.tryClaim(record);
  if (claimed) {
    // Claim won. Only now check the secondary key - a resend with a new message id.
    const secondary = await store.findBySecondaryKey(email.bodyHash, email.senderEmail, email.subject);
    if (secondary && secondary.processingId !== processingId) {
      await store.updateStatus(processingId, 'Duplicate');
      return { kind: 'duplicate', existing: secondary, matchedOn: 'secondaryKey' };
    }
    return { kind: 'claimed', record: claimed };
  }

  // Lost the race: another execution claimed it between our read and our insert. This is the
  // path that makes concurrent Power Automate retries safe.
  const winner = await store.findByInternetMessageId(email.internetMessageId);
  if (winner) {
    return RESUMABLE.has(winner.status)
      ? { kind: 'resumable', existing: winner }
      : { kind: 'duplicate', existing: winner, matchedOn: 'internetMessageId' };
  }

  return { kind: 'duplicate', existing: record, matchedOn: 'internetMessageId' };
}
