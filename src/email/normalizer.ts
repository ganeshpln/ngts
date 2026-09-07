/**
 * Email normalisation: HTML to text, hidden-content removal, quoted-history trimming, capping.
 *
 * Quoted-history trimming is load-bearing, not cosmetic: without it, an old troubleshooting reply
 * quoted beneath a "thanks, all good" message keeps re-triggering SC-01 instead of SC-11.
 */

import { bodyHash } from '../common/hash.js';
import type {
  AttachmentMetadata,
  EmailAddress,
  NormalisedEmail,
  RawEmail,
  ThreadMessage,
} from '../common/types.js';
import { sanitiseContent } from './sanitizer.js';

/** Elements whose content must never reach the model or a log (T-02). */
const REMOVE_ELEMENTS = /<(script|style|head|noscript|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;

/**
 * Blocks hidden with inline CSS - a standard way to hide injected instructions from a human reader
 * while leaving them perfectly visible to a model that is fed the raw HTML.
 */
const HIDDEN_BLOCKS = new RegExp(
  '<([a-z][a-z0-9]*)\\b[^>]*style\\s*=\\s*["\'][^"\']*' +
    '(?:display\\s*:\\s*none|visibility\\s*:\\s*hidden|font-size\\s*:\\s*0(?:px|pt|em)?' +
    '|opacity\\s*:\\s*0(?:\\.0+)?|color\\s*:\\s*#?(?:fff|ffffff|white))' +
    '[^"\']*["\'][^>]*>[\\s\\S]*?<\\/\\1>',
  'gi',
);
const HIDDEN_ATTR = /<([a-z][a-z0-9]*)\b[^>]*\shidden(\s|=|>)[^>]*>[\s\S]*?<\/\1>/gi;

const BLOCK_BREAK = /<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const ANY_TAG = /<[^>]+>/g;

const ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&rsquo;': "'",
  '&lsquo;': "'",
  '&mdash;': '-',
  '&ndash;': '-',
};

/**
 * Markers that begin quoted history. Deliberately conservative: over-trimming loses the sender's
 * own message, which is a worse failure than carrying a little extra context.
 */
const HISTORY_MARKERS: readonly RegExp[] = [
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*_{5,}\s*$/m,
  /^\s*From:\s.+\r?\nSent:\s/im,
  /^\s*From:\s.+\r?\nDate:\s/im,
  /^\s*On\s.{4,80}\swrote:\s*$/im,
  /^\s*>{1,}\s?From:/im,
];

const SIGNATURE_MARKERS: readonly RegExp[] = [
  /^\s*--\s*$/m,
  /^\s*Sent from my (iPhone|iPad|Android|Samsung|mobile device)/im,
  /^\s*This (e-?mail|message) (and any attachments )?(is|are) (confidential|intended)/im,
];

/** Non-breaking space, used in the whitespace collapse. */
const HORIZONTAL_SPACE = new RegExp('[ \\t\\u00A0]+', 'g');

export function htmlToText(html: string): string {
  return html
    .replace(HTML_COMMENTS, ' ')
    .replace(REMOVE_ELEMENTS, ' ')
    .replace(HIDDEN_BLOCKS, ' ')
    .replace(HIDDEN_ATTR, ' ')
    .replace(BLOCK_BREAK, '\n')
    .replace(LINE_BREAK, '\n')
    .replace(ANY_TAG, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ');
}

export function stripQuotedHistory(text: string): string {
  let cut = text.length;
  for (const marker of HISTORY_MARKERS) {
    const m = marker.exec(text);
    if (m && m.index < cut && m.index > 0) cut = m.index;
  }
  return text.slice(0, cut);
}

export function stripSignature(text: string): string {
  let cut = text.length;
  for (const marker of SIGNATURE_MARKERS) {
    const m = marker.exec(text);
    // Only trim in the last two-thirds: "--" can legitimately appear mid-message.
    if (m && m.index < cut && m.index > text.length * 0.33) cut = m.index;
  }
  return text.slice(0, cut);
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(HORIZONTAL_SPACE, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

export interface NormaliseOptions {
  readonly maxBodyChars: number;
  readonly maxSubjectChars: number;
}

function addressOf(a: EmailAddress | undefined): string {
  return (a?.address ?? '').trim().toLowerCase();
}

function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : '';
}

export function normaliseEmail(
  raw: RawEmail,
  attachments: readonly AttachmentMetadata[],
  threadContext: readonly ThreadMessage[],
  options: NormaliseOptions,
): NormalisedEmail {
  const rawText = raw.body.contentType === 'html' ? htmlToText(raw.body.content) : raw.body.content;
  const cleaned = collapseWhitespace(sanitiseContent(stripSignature(stripQuotedHistory(rawText))));

  const truncated = cleaned.length > options.maxBodyChars;
  const body = truncated ? cleaned.slice(0, options.maxBodyChars) : cleaned;

  const subject = sanitiseContent(raw.subject ?? '')
    .slice(0, options.maxSubjectChars)
    .trim();
  const senderEmail = addressOf(raw.from);

  const headers = new Map<string, string>();
  for (const h of raw.internetMessageHeaders ?? []) {
    // Header names are case-insensitive per RFC 5322; normalise once so lookups stay simple.
    headers.set(h.name.toLowerCase(), h.value);
  }

  return {
    messageId: raw.id,
    internetMessageId: raw.internetMessageId,
    conversationId: raw.conversationId,
    subject,
    body,
    // Hashed from the FULL cleaned text, not the truncated body: two long messages differing only
    // past the cap must not collide as duplicates.
    bodyHash: bodyHash(cleaned),
    senderEmail,
    senderName: sanitiseContent(raw.from?.name ?? '').slice(0, 200),
    senderDomain: domainOf(senderEmail),
    toRecipients: (raw.toRecipients ?? []).map(addressOf).filter(Boolean),
    ccRecipients: (raw.ccRecipients ?? []).map(addressOf).filter(Boolean),
    receivedDateTime: raw.receivedDateTime,
    attachments,
    headers,
    threadContext,
    truncated,
  };
}
