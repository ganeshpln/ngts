/**
 * Automatic-reply and out-of-office detection (FR-075, SC-08).
 *
 * Header-first, subject-second. RFC 3834 headers are set by the sending mail system and are
 * locale-independent; the subject prefix "Automatic reply:" is localised, so it is a fallback and
 * carries lower confidence.
 */

export type AutoReplyEvidence = 'auto-submitted' | 'x-auto-response-suppress' | 'precedence' | 'x-autoreply' | 'subject-prefix' | 'body-phrase';

export interface AutoReplyVerdict {
  readonly isAutoReply: boolean;
  readonly evidence: readonly AutoReplyEvidence[];
  /** Header evidence is definitive; subject or body evidence alone is not. */
  readonly definitive: boolean;
}

const SUBJECT_PREFIXES: readonly RegExp[] = [
  /^\s*automatic reply\s*:/i,
  /^\s*auto(matic)?[- ]?reply\s*:/i,
  /^\s*out of (the )?office\s*:/i,
  /^\s*réponse automatique\s*:/i,
  /^\s*respuesta automática\s*:/i,
  /^\s*automatische antwort\s*:/i,
];

const BODY_PHRASES: readonly RegExp[] = [
  /\bi am (currently )?out of the office\b/i,
  /\bi will have limited access to (my )?e-?mail\b/i,
  /\bfor urgent (issues|matters)\b[^.\n]{0,60}\bcontact\b/i,
  /\bi am away from the office\b/i,
];

export function detectAutoReply(
  headers: ReadonlyMap<string, string>,
  subject: string,
  body: string,
): AutoReplyVerdict {
  const evidence: AutoReplyEvidence[] = [];

  const autoSubmitted = headers.get('auto-submitted');
  if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== 'no') {
    evidence.push('auto-submitted');
  }
  if (headers.has('x-auto-response-suppress')) evidence.push('x-auto-response-suppress');
  if (headers.has('x-autoreply') || headers.has('x-autorespond')) evidence.push('x-autoreply');

  const precedence = headers.get('precedence')?.trim().toLowerCase();
  if (precedence === 'bulk' || precedence === 'auto_reply' || precedence === 'junk') {
    evidence.push('precedence');
  }

  const definitive = evidence.length > 0;

  if (SUBJECT_PREFIXES.some((p) => p.test(subject ?? ''))) evidence.push('subject-prefix');
  if (BODY_PHRASES.some((p) => p.test(body ?? ''))) evidence.push('body-phrase');

  return { isAutoReply: evidence.length > 0, evidence, definitive };
}
