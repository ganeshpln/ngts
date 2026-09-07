/**
 * Test doubles and fixtures.
 *
 * The doubles implement the same ports as production, so the scenario suite exercises the real
 * decision pipeline and asserts on exactly which mailbox calls would have been made.
 */

import type {
  ActionResult,
  Classification,
  RawAttachment,
  RawEmail,
  ThreadMessage,
} from '../../src/common/types.js';
import type {
  ProcessingRecord,
  ProcessingStatus,
  ProcessingStore,
} from '../../src/email/idempotency.js';
import type {
  AuditPort,
  AuditRecord,
  ForwardCommand,
  HumanReviewItem,
  HumanReviewPort,
  MailboxPort,
  MoveCommand,
  SendReplyCommand,
} from '../../src/actions/ports.js';

// ---------------------------------------------------------------------------
// Email fixtures
// ---------------------------------------------------------------------------

let counter = 0;

export interface EmailOverrides {
  subject?: string;
  body?: string;
  contentType?: 'html' | 'text';
  from?: { address: string; name?: string };
  headers?: { name: string; value: string }[];
  attachments?: RawAttachment[];
  conversationId?: string;
  internetMessageId?: string;
  receivedDateTime?: string;
  toRecipients?: { address: string; name?: string }[];
}

export function makeEmail(overrides: EmailOverrides = {}): RawEmail {
  counter += 1;
  return {
    id: `AAMkAG-${counter}`,
    internetMessageId: overrides.internetMessageId ?? `<msg-${counter}@pepsico.com>`,
    conversationId: overrides.conversationId ?? `conv-${counter}`,
    conversationIndex: 'AQHa',
    subject: overrides.subject ?? 'Question about my journey',
    body: {
      contentType: overrides.contentType ?? 'text',
      content: overrides.body ?? 'I need some help please.',
    },
    from: overrides.from ?? { address: 'learner@pepsico.com', name: 'Sam Learner' },
    toRecipients: overrides.toRecipients ?? [{ address: 'spa@pepsico.com', name: 'SPA Mailbox' }],
    ccRecipients: [],
    receivedDateTime: overrides.receivedDateTime ?? '2026-09-02T09:00:00Z',
    hasAttachments: (overrides.attachments ?? []).length > 0,
    isRead: false,
    internetMessageHeaders: overrides.headers ?? [],
    attachments: overrides.attachments ?? [],
  };
}

export function makeThread(entries: { from: string; at?: string; subject?: string }[]): ThreadMessage[] {
  return entries.map((e) => ({
    from: e.from,
    receivedDateTime: e.at ?? '2026-09-01T09:00:00Z',
    subject: e.subject ?? 'RE: Question about my journey',
  }));
}

// ---------------------------------------------------------------------------
// Classification fixtures
// ---------------------------------------------------------------------------

export function makeClassification(overrides: Partial<Classification> = {}): Classification {
  return {
    scenarioId: 'SC-01',
    scenarioName: 'Learner cannot advance in FIT/FLO journey',
    program: 'FIT',
    programEvidence: [{ source: 'explicitProgramMention', detail: "sender wrote 'FIT'" }],
    intent: 'learner_blocked_progress',
    subIntent: null,
    confidence: 0.95,
    senderType: 'learner',
    requiresHumanReview: false,
    multiIntent: false,
    secondaryIntents: [],
    extractedEntities: {
      learnerName: null, gpid: null, email: null, program: null, island: null, week: null, errorMessage: null,
    },
    missingRequiredInformation: [],
    recommendedAction: null,
    routingOwner: null,
    routingEmail: null,
    destinationFolder: null,
    responseTemplateId: null,
    reasoningSummary: 'Learner is blocked progressing through their journey.',
    injectionSuspected: false,
    languageDetected: 'en',
    ...overrides,
  };
}

/** Serialise a classification the way the model would return it. */
export function asModelOutput(classification: Partial<Classification> = {}): string {
  return JSON.stringify(makeClassification(classification));
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export class InMemoryProcessingStore implements ProcessingStore {
  private readonly byInternetMessageId = new Map<string, ProcessingRecord>();
  private readonly bySecondary = new Map<string, ProcessingRecord>();
  outboundCounts = new Map<string, number>();
  claimAttempts = 0;

  private secondaryKey(bodyHash: string, sender: string, subject: string): string {
    return `${bodyHash}|${sender}|${subject}`;
  }

  async tryClaim(record: ProcessingRecord): Promise<ProcessingRecord | null> {
    this.claimAttempts += 1;
    // Mirrors the Dataverse alternate-key behaviour: the insert fails if the key is taken.
    if (this.byInternetMessageId.has(record.internetMessageId)) return null;
    this.byInternetMessageId.set(record.internetMessageId, record);
    // First writer wins on the secondary key, mirroring a Dataverse query ordered by created date:
    // a resend must resolve to the ORIGINAL processing row, not overwrite it.
    const secondary = this.secondaryKey(record.bodyHash, record.senderEmail, record.subject);
    if (!this.bySecondary.has(secondary)) this.bySecondary.set(secondary, record);
    return record;
  }

  async findByInternetMessageId(id: string): Promise<ProcessingRecord | null> {
    return this.byInternetMessageId.get(id) ?? null;
  }

  async findBySecondaryKey(bodyHash: string, sender: string, subject: string): Promise<ProcessingRecord | null> {
    return this.bySecondary.get(this.secondaryKey(bodyHash, sender, subject)) ?? null;
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

  /** Simulate a prior processing attempt in a given terminal state. */
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
    this.bySecondary.set(this.secondaryKey(full.bodyHash, full.senderEmail, full.subject), full);
  }
}

export interface RecordedCall {
  readonly kind: 'sendReply' | 'forward' | 'move' | 'markAsRead' | 'softDelete' | 'hardDelete';
  readonly payload: unknown;
}

export class RecordingMailbox implements MailboxPort {
  readonly calls: RecordedCall[] = [];
  failOn: RecordedCall['kind'] | null = null;

  private result(kind: RecordedCall['kind'], sequence = 0): ActionResult {
    if (this.failOn === kind) {
      return { sequence, actionType: 'MarkAsRead', status: 'Failed', errorCode: 'TEST', errorMessage: 'forced failure' };
    }
    return { sequence, actionType: 'MarkAsRead', status: 'Succeeded' };
  }

  async sendReply(command: SendReplyCommand): Promise<ActionResult> {
    this.calls.push({ kind: 'sendReply', payload: command });
    return this.result('sendReply');
  }
  async forward(command: ForwardCommand): Promise<ActionResult> {
    this.calls.push({ kind: 'forward', payload: command });
    return this.result('forward');
  }
  async move(command: MoveCommand): Promise<{ result: ActionResult; newMessageId: string | null }> {
    this.calls.push({ kind: 'move', payload: command });
    return { result: this.result('move'), newMessageId: `${command.messageId}-moved` };
  }
  async markAsRead(messageId: string): Promise<ActionResult> {
    this.calls.push({ kind: 'markAsRead', payload: { messageId } });
    return this.result('markAsRead');
  }
  async softDelete(messageId: string): Promise<ActionResult> {
    this.calls.push({ kind: 'softDelete', payload: { messageId } });
    return this.result('softDelete');
  }
  async hardDelete(messageId: string): Promise<ActionResult> {
    this.calls.push({ kind: 'hardDelete', payload: { messageId } });
    return this.result('hardDelete');
  }

  recipients(): string[] {
    return this.calls.flatMap((c) => {
      const p = c.payload as { toRecipients?: readonly string[] };
      return [...(p.toRecipients ?? [])];
    });
  }
  kinds(): string[] {
    return this.calls.map((c) => c.kind);
  }
}

export class RecordingHumanReview implements HumanReviewPort {
  readonly items: HumanReviewItem[] = [];
  async enqueue(item: HumanReviewItem): Promise<ActionResult> {
    this.items.push(item);
    return { sequence: 0, actionType: 'EscalateToHumanReview', status: 'Succeeded' };
  }
}

export class RecordingAudit implements AuditPort {
  readonly records: AuditRecord[] = [];
  async recordAction(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}
