/**
 * In-memory ProcessingStore.
 *
 * Used by the shadow-run CLI and by the test suite. It mirrors the semantics the Dataverse
 * implementation gets from the platform:
 *
 *  - `tryClaim` is a conditional insert on `internetMessageId` (the alternate key), so a second
 *    claim of the same message fails rather than overwriting.
 *  - the secondary-key index is first-writer-wins, mirroring a Dataverse query ordered by created
 *    date - a resend must resolve to the ORIGINAL processing row, not replace it.
 *
 * It is not a substitute for verifying the real alternate key in DEV; it exists so the same code
 * paths can be exercised without a database.
 */

import type { ProcessingRecord, ProcessingStatus, ProcessingStore } from './idempotency.js';

export class InMemoryProcessingStore implements ProcessingStore {
  private readonly byInternetMessageId = new Map<string, ProcessingRecord>();
  private readonly bySecondary = new Map<string, ProcessingRecord>();

  readonly outboundCounts = new Map<string, number>();
  claimAttempts = 0;

  private secondaryKey(bodyHash: string, senderEmail: string, subject: string): string {
    return `${bodyHash}|${senderEmail}|${subject}`;
  }

  async tryClaim(record: ProcessingRecord): Promise<ProcessingRecord | null> {
    this.claimAttempts += 1;
    if (this.byInternetMessageId.has(record.internetMessageId)) return null;

    this.byInternetMessageId.set(record.internetMessageId, record);
    const secondary = this.secondaryKey(record.bodyHash, record.senderEmail, record.subject);
    if (!this.bySecondary.has(secondary)) this.bySecondary.set(secondary, record);
    return record;
  }

  async findByInternetMessageId(internetMessageId: string): Promise<ProcessingRecord | null> {
    return this.byInternetMessageId.get(internetMessageId) ?? null;
  }

  async findBySecondaryKey(bodyHash: string, senderEmail: string, subject: string): Promise<ProcessingRecord | null> {
    return this.bySecondary.get(this.secondaryKey(bodyHash, senderEmail, subject)) ?? null;
  }

  async updateStatus(processingId: string, status: ProcessingStatus): Promise<void> {
    for (const [key, record] of this.byInternetMessageId) {
      if (record.processingId === processingId) {
        this.byInternetMessageId.set(key, { ...record, status });
      }
    }
  }

  async countOutboundForConversation(conversationId: string): Promise<number> {
    return this.outboundCounts.get(conversationId) ?? 0;
  }

  /** Simulate a prior processing attempt in a given state. */
  seed(record: Partial<ProcessingRecord> & { internetMessageId: string }): void {
    const full: ProcessingRecord = {
      processingId: record.processingId ?? 'seeded',
      internetMessageId: record.internetMessageId,
      messageId: record.messageId ?? 'seeded-message',
      conversationId: record.conversationId ?? 'seeded-conversation',
      bodyHash: record.bodyHash ?? 'seeded-hash',
      senderEmail: record.senderEmail ?? 'learner@pepsico.com',
      subject: record.subject ?? 'seeded',
      status: record.status ?? 'Completed',
      retryCount: record.retryCount ?? 0,
      createdDate: record.createdDate ?? '2026-09-01T00:00:00Z',
    };
    this.byInternetMessageId.set(full.internetMessageId, full);
    const secondary = this.secondaryKey(full.bodyHash, full.senderEmail, full.subject);
    if (!this.bySecondary.has(secondary)) this.bySecondary.set(secondary, full);
  }

  get size(): number {
    return this.byInternetMessageId.size;
  }
}
