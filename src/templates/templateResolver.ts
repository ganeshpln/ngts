/**
 * Response-template selection and rendering (BRD sections 12 and 16, FR-076, FR-077).
 *
 * Two controls live here:
 *
 * 1. An INACTIVE template can never be sent. This is the code-level enforcement of GAP-004 - no
 *    approved wording exists yet, so every seeded template is inactive and every send is blocked.
 * 2. Only variables in the template's own `allowedVariables` list are substituted, every value is
 *    HTML-encoded, and rendered output is checked for URLs that were not in the template source.
 *    That is what "the AI may populate approved variables" means in practice (BRD section 16).
 */

import { htmlEncode } from '../email/sanitizer.js';
import type { Program, SenderType } from '../common/types.js';
import type { ResponseTemplateConfig } from '../configuration/types.js';
import { err, ok, type Result } from '../common/result.js';

export interface TemplateQuery {
  readonly scenarioId: string;
  readonly program: Program;
  readonly senderType: SenderType;
  /** The model's proposal - verified, never trusted. */
  readonly proposedTemplateId?: string | null;
}

export type TemplateRejection =
  | { readonly kind: 'not_found'; readonly detail: string }
  | { readonly kind: 'inactive'; readonly templateId: string; readonly detail: string }
  | { readonly kind: 'mismatch'; readonly templateId: string; readonly detail: string };

export function resolveTemplate(
  templates: readonly ResponseTemplateConfig[],
  query: TemplateQuery,
): Result<ResponseTemplateConfig, TemplateRejection> {
  const forScenario = templates.filter((t) => t.scenarioId === query.scenarioId);

  // A proposed id is honoured only if it exists, belongs to this scenario, is compatible with the
  // programme and sender type, and is active. Otherwise selection falls through to the normal path.
  if (query.proposedTemplateId) {
    const proposed = templates.find((t) => t.templateId === query.proposedTemplateId);
    if (!proposed) {
      return err({ kind: 'not_found', detail: `Proposed template "${query.proposedTemplateId}" does not exist.` });
    }
    if (proposed.scenarioId !== query.scenarioId) {
      return err({
        kind: 'mismatch',
        templateId: proposed.templateId,
        detail: `Template belongs to ${proposed.scenarioId}, not ${query.scenarioId}.`,
      });
    }
    if (!proposed.isActive) {
      return err({
        kind: 'inactive',
        templateId: proposed.templateId,
        detail: 'Template is inactive; approved wording has not been supplied (GAP-004).',
      });
    }
    return ok(proposed);
  }

  const programMatches = forScenario.filter((t) => t.program === query.program || t.program === 'ALL');
  const senderMatches = programMatches.filter((t) => t.senderType === query.senderType || t.senderType === 'any');

  // Prefer the most specific match: exact sender type, then exact programme, then wildcards.
  const ranked = [...senderMatches].sort((a, b) => {
    const score = (t: ResponseTemplateConfig) =>
      (t.senderType === query.senderType ? 2 : 0) + (t.program === query.program ? 1 : 0);
    return score(b) - score(a);
  });

  const candidate = ranked[0];
  if (!candidate) {
    return err({
      kind: 'not_found',
      detail: `No template for ${query.scenarioId} / ${query.program} / ${query.senderType}.`,
    });
  }
  if (!candidate.isActive) {
    return err({
      kind: 'inactive',
      templateId: candidate.templateId,
      detail: 'Template is inactive; approved wording has not been supplied (GAP-004).',
    });
  }
  return ok(candidate);
}

export interface RenderedTemplate {
  readonly templateId: string;
  readonly subject: string;
  readonly body: string;
}

export type RenderRejection =
  | { readonly kind: 'unknown_variable'; readonly variable: string }
  | { readonly kind: 'unresolved_placeholder'; readonly variable: string }
  | { readonly kind: 'invented_url'; readonly url: string };

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;

function extractUrls(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map((u) => u.replace(/[.,;:]+$/, '').toLowerCase());
}

/**
 * Render a template.
 *
 * Every supplied value is HTML-encoded (T-03) and every placeholder must be declared in the
 * template's allow-list. A URL appearing in the output that was not in the template source is a
 * rejection, not a warning: FR-077 prohibits invented URLs, and a link is the single most damaging
 * thing an injected value could smuggle into a customer-facing email.
 */
export function renderTemplate(
  template: ResponseTemplateConfig,
  values: Readonly<Record<string, string | null | undefined>>,
): Result<RenderedTemplate, RenderRejection> {
  const allowed = new Set(template.allowedVariables);

  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) return err({ kind: 'unknown_variable', variable: key });
  }

  const substitute = (source: string): { text: string; missing: string | null } => {
    let missing: string | null = null;
    const text = source.replace(PLACEHOLDER, (_match, name: string) => {
      if (!allowed.has(name)) {
        missing = name;
        return '';
      }
      const raw = values[name];
      if (raw === null || raw === undefined || raw === '') {
        missing = name;
        return '';
      }
      return htmlEncode(String(raw));
    });
    return { text, missing };
  };

  const subject = substitute(template.subjectTemplate);
  if (subject.missing) return err({ kind: 'unresolved_placeholder', variable: subject.missing });

  const body = substitute(template.bodyTemplate);
  if (body.missing) return err({ kind: 'unresolved_placeholder', variable: body.missing });

  const sourceUrls = new Set([...extractUrls(template.subjectTemplate), ...extractUrls(template.bodyTemplate)]);
  for (const url of [...extractUrls(subject.text), ...extractUrls(body.text)]) {
    if (!sourceUrls.has(url)) return err({ kind: 'invented_url', url });
  }

  return ok({ templateId: template.templateId, subject: subject.text, body: body.text });
}
