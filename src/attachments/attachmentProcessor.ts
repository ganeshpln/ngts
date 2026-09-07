/**
 * Attachment processing (FR-080 to FR-083, BRD section 18).
 *
 * Metadata is ALWAYS extracted. Content is NEVER downloaded unless a registered handler supports
 * the MIME type and the feature flag is on (threat T-14, GAP-019). With no handler enabled - the
 * default - no attachment byte is ever fetched, opened or executed.
 */

import { extractExtension, sanitiseFileName } from '../email/sanitizer.js';
import type { AttachmentMetadata, RawAttachment } from '../common/types.js';
import type { AttachmentConfig } from '../configuration/types.js';

export interface AttachmentInsight {
  readonly handler: string;
  readonly summary: string;
  readonly extractedText?: string;
}

/** Extension point required by FR-083. */
export interface AttachmentHandler {
  readonly name: string;
  supports(meta: AttachmentMetadata): boolean;
  process(meta: AttachmentMetadata, content: Buffer): Promise<AttachmentInsight>;
}

export interface AttachmentSummary {
  readonly count: number;
  readonly meaningfulCount: number;
  readonly hasScreenshot: boolean;
  readonly hasUnsupported: boolean;
  readonly oversized: readonly string[];
  /** Short, sanitised description passed to the classifier as a signal (FR-081). */
  readonly promptSummary: string;
}

export function extractMetadata(
  attachments: readonly RawAttachment[],
  config: AttachmentConfig,
): readonly AttachmentMetadata[] {
  return attachments.map((a) => {
    const fileName = sanitiseFileName(a.name);
    const extension = extractExtension(fileName);
    const mimeType = (a.contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';

    // Supported requires BOTH the extension and the MIME type to be allow-listed. Either alone is
    // trivially spoofable - a renamed executable satisfies the extension check, a mislabelled
    // Content-Type satisfies the MIME check.
    const supported =
      config.supportedExtensions.includes(extension) &&
      config.supportedMimeTypes.includes(mimeType) &&
      a.size <= config.maxSizeBytes;

    return {
      attachmentId: a.id,
      fileName,
      extension,
      mimeType,
      sizeBytes: a.size,
      isInline: a.isInline,
      supported,
      isScreenshot: config.screenshotExtensions.includes(extension) && !a.isInline,
    };
  });
}

export function summarise(
  attachments: readonly AttachmentMetadata[],
  config: AttachmentConfig,
): AttachmentSummary {
  const meaningful = config.ignoreInlineImages ? attachments.filter((a) => !a.isInline) : [...attachments];
  const oversized = attachments.filter((a) => a.sizeBytes > config.maxSizeBytes).map((a) => a.fileName);
  const hasScreenshot = meaningful.some((a) => a.isScreenshot);

  const promptSummary =
    meaningful.length === 0
      ? 'none'
      : meaningful
          .map((a) => `${a.fileName} (${a.extension || 'no extension'}, ${a.sizeBytes} bytes${a.isScreenshot ? ', screenshot' : ''})`)
          .join('; ');

  return {
    count: attachments.length,
    meaningfulCount: meaningful.length,
    hasScreenshot,
    hasUnsupported: meaningful.some((a) => !a.supported),
    oversized,
    promptSummary,
  };
}

export class AttachmentProcessor {
  private readonly handlers: AttachmentHandler[] = [];

  constructor(
    private readonly config: AttachmentConfig,
    private readonly contentHandlersEnabled: boolean,
  ) {}

  register(handler: AttachmentHandler): void {
    this.handlers.push(handler);
  }

  process(attachments: readonly RawAttachment[]): {
    metadata: readonly AttachmentMetadata[];
    summary: AttachmentSummary;
  } {
    const metadata = extractMetadata(attachments, this.config);
    return { metadata, summary: summarise(metadata, this.config) };
  }

  /**
   * Content processing is opt-in twice over: the feature flag must be on AND a registered handler
   * must claim the attachment. Returns an empty list otherwise - and, importantly, the caller
   * never fetches content when this returns empty.
   */
  handlersFor(meta: AttachmentMetadata): readonly AttachmentHandler[] {
    if (!this.contentHandlersEnabled) return [];
    if (!meta.supported) return [];
    return this.handlers.filter((h) => h.supports(meta));
  }

  get contentProcessingEnabled(): boolean {
    return this.contentHandlersEnabled && this.handlers.length > 0;
  }
}
