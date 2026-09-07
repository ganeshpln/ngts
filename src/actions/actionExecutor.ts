/**
 * Action execution (BRD Phase 4, NFR-002, NFR-003).
 *
 * Executes an already-validated plan in order. It makes no decisions - if it is asked to do
 * something, the ActionValidator has already approved it.
 *
 * Two properties matter on failure:
 *   - The sequence HALTS. A half-executed plan (forwarded but not filed) is worse than a stopped
 *     one, because it is invisible.
 *   - The original message is NEVER moved or deleted on a failure path, so nothing is lost.
 */

import { isApprovedAction, missingParameters } from './actionRegistry.js';
import type { AuditPort, HumanReviewPort, MailboxPort } from './ports.js';
import type { ActionPlanItem, ActionResult, Decision } from '../common/types.js';
import type { Logger } from '../common/logger.js';

export interface ExecutionContext {
  readonly messageId: string;
  readonly processingId: string;
  /** Shadow mode: decide and audit everything, execute nothing (ASM-04). */
  readonly shadowMode: boolean;
}

export interface ExecutionOutcome {
  readonly results: readonly ActionResult[];
  readonly halted: boolean;
  readonly haltedAtSequence: number | null;
}

export class ActionExecutor {
  constructor(
    private readonly mailbox: MailboxPort,
    private readonly humanReview: HumanReviewPort,
    private readonly audit: AuditPort,
    private readonly logger: Logger,
  ) {}

  async execute(decision: Decision, context: ExecutionContext): Promise<ExecutionOutcome> {
    const results: ActionResult[] = [];
    // A move changes the Graph message id, so later steps must use the new one.
    let currentMessageId = context.messageId;

    for (const item of decision.actionPlan) {
      if (!isApprovedAction(item.actionType)) {
        // Belt and braces: the validator has already checked this, but an unapproved action name
        // reaching an executor is the failure this system exists to make impossible.
        results.push({
          sequence: item.sequence,
          actionType: item.actionType,
          status: 'Failed',
          errorCode: 'EX-001',
          errorMessage: 'Action is not in the approved action set.',
        });
        await this.recordAudit(context.processingId, item, 'Failed', 'EX-001');
        return { results, halted: true, haltedAtSequence: item.sequence };
      }

      const missing = missingParameters(item.actionType, item.parameters as Record<string, unknown>);
      if (missing.length > 0) {
        results.push({
          sequence: item.sequence,
          actionType: item.actionType,
          status: 'Failed',
          errorCode: 'EX-002',
          errorMessage: `Missing required parameters: ${missing.join(', ')}.`,
        });
        await this.recordAudit(context.processingId, item, 'Failed', 'EX-002');
        return { results, halted: true, haltedAtSequence: item.sequence };
      }

      if (context.shadowMode && item.actionType !== 'EscalateToHumanReview') {
        // Shadow mode still audits, so the business can see exactly what would have happened.
        const shadowed: ActionResult = { sequence: item.sequence, actionType: item.actionType, status: 'Shadowed' };
        results.push(shadowed);
        await this.recordAudit(context.processingId, item, 'Shadowed');
        this.logger.info('Action shadowed', {
          processingId: context.processingId,
          selectedAction: item.actionType,
          stage: 'Execute',
        });
        continue;
      }

      let result: ActionResult;
      try {
        const executed = await this.runAction(item, currentMessageId, decision, context);
        result = executed.result;
        if (executed.newMessageId) currentMessageId = executed.newMessageId;
      } catch (error) {
        result = {
          sequence: item.sequence,
          actionType: item.actionType,
          status: 'Failed',
          errorCode: 'EX-003',
          errorMessage: error instanceof Error ? error.message : 'Unknown execution failure.',
        };
      }

      results.push(result);
      await this.recordAudit(context.processingId, item, result.status, result.errorCode, result.errorMessage);

      if (result.status === 'Failed') {
        this.logger.error('Action failed; halting the plan', {
          processingId: context.processingId,
          selectedAction: item.actionType,
          errorCode: result.errorCode,
          stage: 'Execute',
        });
        return { results, halted: true, haltedAtSequence: item.sequence };
      }
    }

    return { results, halted: false, haltedAtSequence: null };
  }

  private async runAction(
    item: ActionPlanItem,
    messageId: string,
    decision: Decision,
    context: ExecutionContext,
  ): Promise<{ result: ActionResult; newMessageId?: string | null }> {
    const p = item.parameters;

    switch (item.actionType) {
      case 'SendResponse':
        return {
          result: await this.mailbox.sendReply({
            messageId,
            processingId: context.processingId,
            subject: p.subject as string,
            body: p.body as string,
            toRecipients: p.toRecipients ?? [],
          }),
        };

      case 'ForwardEmail':
      case 'RouteToProgramOwner':
      case 'RouteToChangeRequest':
        return {
          result: await this.mailbox.forward({
            messageId,
            processingId: context.processingId,
            toRecipients: p.toRecipients ?? [],
          }),
        };

      case 'MoveEmail': {
        const moved = await this.mailbox.move({ messageId, destinationFolder: p.destinationFolder as string });
        return { result: moved.result, newMessageId: moved.newMessageId };
      }

      case 'MarkAsRead':
        return { result: await this.mailbox.markAsRead(messageId) };

      case 'DeleteEmail':
        return {
          result: p.hardDelete === true
            ? await this.mailbox.hardDelete(messageId)
            : await this.mailbox.softDelete(messageId),
        };

      case 'EscalateToHumanReview':
        return {
          result: await this.humanReview.enqueue({
            processingId: context.processingId,
            reason: decision.humanReviewReason ?? 'HIL-07',
            scenarioId: item.scenarioId,
            program: decision.programResolution.program,
            confidence: decision.confidence.effectiveConfidence,
            proposedPlan: JSON.stringify(
              decision.actionPlan.map((a) => ({ actionType: a.actionType, destination: a.resolvedDestination })),
            ),
            messageId,
          }),
        };

      default:
        return {
          result: {
            sequence: item.sequence,
            actionType: item.actionType,
            status: 'Skipped',
            errorCode: 'EX-004',
            errorMessage: `No executor is registered for "${item.actionType}".`,
          },
        };
    }
  }

  private async recordAudit(
    processingId: string,
    item: ActionPlanItem,
    status: string,
    errorCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.audit.recordAction({
      processingId,
      sequence: item.sequence,
      actionType: item.actionType,
      resolvedDestination: item.resolvedDestination,
      status,
      errorCode,
      errorMessage,
    });
  }
}
