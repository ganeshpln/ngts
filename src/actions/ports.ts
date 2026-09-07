/**
 * Outbound ports for the action engine.
 *
 * The domain depends on these interfaces; Power Automate/Graph implements them in production and a
 * recording fake implements them in tests. That is what lets the scenario suite assert exactly
 * which mailbox calls a given email would produce, without a mailbox.
 */

import type { ActionResult, HumanReviewReason } from '../common/types.js';

export interface SendReplyCommand {
  readonly messageId: string;
  readonly processingId: string;
  readonly subject: string;
  readonly body: string;
  readonly toRecipients: readonly string[];
}

export interface ForwardCommand {
  readonly messageId: string;
  readonly processingId: string;
  readonly toRecipients: readonly string[];
  readonly comment?: string;
}

export interface MoveCommand {
  readonly messageId: string;
  readonly destinationFolder: string;
}

export interface MailboxPort {
  sendReply(command: SendReplyCommand): Promise<ActionResult>;
  forward(command: ForwardCommand): Promise<ActionResult>;
  /** Returns the NEW message id: a move changes it (docs/integration-design.md section 1). */
  move(command: MoveCommand): Promise<{ result: ActionResult; newMessageId: string | null }>;
  markAsRead(messageId: string): Promise<ActionResult>;
  softDelete(messageId: string): Promise<ActionResult>;
  hardDelete(messageId: string): Promise<ActionResult>;
}

export interface HumanReviewItem {
  readonly processingId: string;
  readonly reason: HumanReviewReason;
  readonly scenarioId: string;
  readonly program: string;
  readonly confidence: number;
  readonly proposedPlan: string;
  readonly messageId: string;
}

export interface HumanReviewPort {
  enqueue(item: HumanReviewItem): Promise<ActionResult>;
}

export interface AuditRecord {
  readonly processingId: string;
  readonly sequence: number;
  readonly actionType: string;
  readonly resolvedDestination: string | null;
  readonly status: string;
  readonly rejectionReason?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface AuditPort {
  recordAction(record: AuditRecord): Promise<void>;
}
