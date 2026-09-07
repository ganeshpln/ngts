/**
 * Input sanitisation. Email content is untrusted (Rule 13, NFR-013).
 *
 * These functions run before content reaches the model, the audit store, or a log line.
 */

/**
 * Zero-width, soft hyphen and bidi-override characters used to hide injected text (T-02, T-04).
 * Built from escape sequences so the pattern itself contains no invisible characters.
 */
const INVISIBLE_CHARS = new RegExp(
  '[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF\\u00AD]',
  'g',
);

/** C0/C1 control characters, except tab, newline and carriage return. */
const CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]',
  'g',
);

/** Attempts to break out of the prompt's content delimiters (T-01 layer 1). */
const DELIMITER_ESCAPES: readonly RegExp[] = [
  /<<<\s*EMAIL_CONTENT_(START|END)\s*>>>/gi,
  /<\|(im_start|im_end|system|user|assistant)\|>/gi,
  /^\s*(system|assistant)\s*:/gim,
];

export function stripInvisibleCharacters(text: string): string {
  return (text ?? '').replace(INVISIBLE_CHARS, '').replace(CONTROL_CHARS, '');
}

export function neutraliseDelimiterEscapes(text: string): string {
  let out = text;
  for (const pattern of DELIMITER_ESCAPES) {
    out = out.replace(pattern, (m) => `[removed:${m.length}]`);
  }
  return out;
}

export function sanitiseContent(text: string): string {
  return neutraliseDelimiterEscapes(stripInvisibleCharacters(text ?? ''));
}

/**
 * Sanitise an attachment filename (T-04).
 *
 * A filename is attacker-controlled text. It is never used as a filesystem path here, but it does
 * reach logs, the audit store, the review UI and the prompt - so path separators, bidi overrides
 * (which make "exe.txt" render as "txt.exe") and control characters all have to go.
 */
export function sanitiseFileName(name: string): string {
  const stripped = stripInvisibleCharacters(name ?? '')
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim();
  const collapsed = stripped.replace(/\s+/g, ' ');
  return collapsed.slice(0, 255) || 'unnamed';
}

/**
 * Extension from the FINAL segment of a sanitised filename.
 *
 * "report.pdf.exe" yields "exe", not "pdf" - taking the first extension is how a spoofed
 * double-extension gets treated as a supported type.
 */
export function extractExtension(sanitisedFileName: string): string {
  const idx = sanitisedFileName.lastIndexOf('.');
  if (idx <= 0 || idx === sanitisedFileName.length - 1) return '';
  return sanitisedFileName.slice(idx + 1).toLowerCase();
}

/** HTML-encode a value destined for an outbound HTML email body (T-03). */
export function htmlEncode(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
