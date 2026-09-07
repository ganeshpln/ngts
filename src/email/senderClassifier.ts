/**
 * Deterministic sender-type signals (GAP-007 / Q-17).
 *
 * The BRD references "sender type" for SC-12 template selection but never enumerates the values.
 * The model proposes a type; this module supplies deterministic corroboration from the sender's
 * domain and directory attributes, and always wins on the internal/external distinction because
 * that is a fact, not a judgement.
 */

import type { SenderType } from '../common/types.js';
import type { SenderTypeConfig } from '../configuration/types.js';

export interface DirectoryAttributes {
  readonly department?: string;
  readonly jobTitle?: string;
}

export interface SenderTypeResolution {
  readonly senderType: SenderType;
  readonly isInternal: boolean;
  /** True when the deterministic layer changed the model's proposal. */
  readonly overrodeModel: boolean;
  readonly reason: string;
}

export function resolveSenderType(
  proposed: SenderType,
  senderDomain: string,
  config: SenderTypeConfig,
  directory?: DirectoryAttributes,
): SenderTypeResolution {
  const domain = (senderDomain ?? '').toLowerCase();
  const isInternal = config.internalDomains.some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`));

  // An external sender can never be an internal role. Domain is a fact; the model's read of the
  // prose is an inference, and the fact wins.
  if (!isInternal) {
    const internalOnly: readonly SenderType[] = ['learner', 'manager', 'peer_trainer', 'hr', 'internal'];
    if (internalOnly.includes(proposed)) {
      return {
        senderType: 'external',
        isInternal: false,
        overrodeModel: true,
        reason: `Sender domain "${domain}" is not an internal domain, so an internal role cannot apply.`,
      };
    }
    return { senderType: proposed, isInternal: false, overrodeModel: false, reason: 'External sender.' };
  }

  if (proposed === 'external') {
    return {
      senderType: 'internal',
      isInternal: true,
      overrodeModel: true,
      reason: `Sender domain "${domain}" is internal, contradicting an external classification.`,
    };
  }

  if (proposed === 'unknown' && directory?.department) {
    const dept = directory.department.toLowerCase();
    if (dept.includes('human resources') || dept === 'hr') {
      return { senderType: 'hr', isInternal: true, overrodeModel: true, reason: 'Directory department indicates HR.' };
    }
  }

  return { senderType: proposed, isInternal: true, overrodeModel: false, reason: 'Model proposal accepted.' };
}
