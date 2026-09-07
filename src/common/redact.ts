/**
 * Telemetry redaction (NFR-007, threat T-13).
 *
 * Applied by the logger itself rather than at call sites: a call site can forget, a logger cannot.
 * Nothing here is reversible - the point is that the telemetry store never receives the value.
 */

import { createHash } from 'node:crypto';

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** GPID: PepsiCo Global Personnel ID. Conservative - 6 to 12 digits standing alone. */
const GPID_PATTERN = /\b\d{6,12}\b/g;

const SENSITIVE_KEYS = new Set([
  'body',
  'bodypreview',
  'bodyhtml',
  'content',
  'subject',
  'gpid',
  'learnername',
  'sendername',
  'senderemail',
  'email',
  'toRecipients'.toLowerCase(),
  'ccrecipients',
  'errormessage',
  'rawoutput',
  // These are the names of fields to REDACT, not credentials.
  'password',
  'token',
  'secret',
  'authorization',
  'apikey', // secret-scan:ignore
]);

/** One-way, stable within a deployment: lets telemetry correlate without storing the value. */
export function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function redactEmailAddress(address: string): string {
  const at = address.indexOf('@');
  if (at <= 0) return `<redacted:${hashIdentifier(address)}>`;
  // Domain is retained: it is not personal data and it is operationally useful
  // (it drives the external-recipient control, GAP-017).
  return `<redacted:${hashIdentifier(address)}>@${address.slice(at + 1)}`;
}

export function redactText(text: string): string {
  return text.replace(EMAIL_PATTERN, (m) => redactEmailAddress(m)).replace(GPID_PATTERN, '<gpid>');
}

/**
 * Deep-redact an arbitrary telemetry payload. Sensitive keys are replaced with a length marker
 * rather than removed, so operators can still tell that a field was populated.
 */
export function redactObject(input: unknown, depth = 0): unknown {
  if (depth > 8) return '<max-depth>';
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return redactText(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map((v) => redactObject(v, depth + 1));
  if (input instanceof Date) return input.toISOString();
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] =
          typeof value === 'string'
            ? `<redacted:len=${value.length}>`
            : value === null || value === undefined
              ? value
              : '<redacted>';
      } else {
        out[key] = redactObject(value, depth + 1);
      }
    }
    return out;
  }
  return '<unserialisable>';
}
