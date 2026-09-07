/**
 * Loop prevention (FR-073, FR-074, threat T-05).
 *
 * Four independent checks. Any one of them halts processing, because a mail loop is one of the few
 * failure modes here that is both self-amplifying and visible to the whole business.
 */

import type { GuardVerdict, NormalisedEmail } from '../common/types.js';
import type { SafetyConfig } from '../configuration/types.js';
import { detectAutoReply } from './autoReplyDetector.js';

export interface LoopContext {
  /** Outbound messages already sent by the automation on this conversation. */
  readonly outboundCountForConversation: number;
  readonly mailboxAddress: string | null;
}

function normalise(address: string): string {
  return (address ?? '').trim().toLowerCase();
}

export function checkLoop(
  email: NormalisedEmail,
  safety: SafetyConfig,
  context: LoopContext,
): GuardVerdict {
  const sender = normalise(email.senderEmail);

  // 1. The message was sent by the automation itself, or by the mailbox it monitors.
  const selfIdentities = new Set<string>(
    [...safety.botIdentities.map(normalise), normalise(context.mailboxAddress ?? '')].filter(Boolean),
  );
  if (selfIdentities.has(sender)) {
    return { blocked: true, reason: 'SelfSent', detail: 'Sender is the automation or the monitored mailbox.' };
  }

  // 2. The message carries the header the automation stamps on everything it sends. This is the
  //    structural check: it survives display-name spoofing and alias changes.
  const botHeader = email.headers.get(safety.botHeaderName.toLowerCase());
  if (botHeader) {
    return { blocked: true, reason: 'SelfSent', detail: `Carries ${safety.botHeaderName}, so it originated here.` };
  }

  // 3. An auto-reply with definitive header evidence, arriving on a conversation the automation has
  //    already replied to, is the classic ping-pong loop. Auto-replies with no prior outbound are
  //    left to flow through to SC-08, which is where the BRD handles them.
  const autoReply = detectAutoReply(email.headers, email.subject, email.body);
  if (autoReply.definitive && context.outboundCountForConversation > 0) {
    return {
      blocked: true,
      reason: 'AutoReplyLoop',
      detail: 'Automatic reply received on a conversation this system has already replied to.',
    };
  }

  // 4. Backstop: whatever the cause, never exceed the configured outbound count per conversation.
  if (context.outboundCountForConversation >= safety.maxOutboundPerConversation) {
    return {
      blocked: true,
      reason: 'ConversationCapExceeded',
      detail: `Outbound cap of ${safety.maxOutboundPerConversation} reached for this conversation.`,
    };
  }

  return { blocked: false, reason: null, detail: null };
}
