/**
 * Owner-response suppression (FR-011, BRD section 1.11).
 *
 * "Avoid further BOT processing when the designated human owner has responded."
 *
 * REQUIREMENT GAP GAP-015 / Q-10: the BRD does not define what "responded" means, how long
 * suppression lasts, or which addresses count as owners. Implemented as: an owner address appears
 * as a SENDER on the conversation. Scope, expiry and the owner list are all configuration.
 *
 * Sender identity comes from the authenticated Graph sender, never from a display name, because a
 * spoofed display name would otherwise let an outsider silence the automation (threat T-09).
 */

import type { GuardVerdict, ThreadMessage } from '../common/types.js';
import type { SafetyConfig } from '../configuration/types.js';

export interface OwnerResponseContext {
  readonly threadContext: readonly ThreadMessage[];
  readonly now: Date;
}

function normalise(address: string): string {
  return (address ?? '').trim().toLowerCase();
}

export function checkOwnerResponded(
  safety: SafetyConfig,
  enabled: boolean,
  context: OwnerResponseContext,
): GuardVerdict {
  if (!enabled) return { blocked: false, reason: null, detail: null };

  const owners = new Set(safety.ownerResponseSuppression.ownerAddresses.map(normalise));
  if (owners.size === 0) return { blocked: false, reason: null, detail: null };

  const expiryHours = safety.ownerResponseSuppression.expiryHours;

  for (const message of context.threadContext) {
    if (!owners.has(normalise(message.from))) continue;

    if (expiryHours !== null && expiryHours !== undefined) {
      const sentAt = new Date(message.receivedDateTime).getTime();
      if (Number.isNaN(sentAt)) continue;
      const ageHours = (context.now.getTime() - sentAt) / 3_600_000;
      if (ageHours > expiryHours) continue; // suppression has lapsed
    }

    return {
      blocked: true,
      reason: 'OwnerResponded',
      detail: 'A designated owner has already responded on this conversation (FR-011).',
    };
  }

  return { blocked: false, reason: null, detail: null };
}
