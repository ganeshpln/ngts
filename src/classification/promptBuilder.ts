/**
 * Prompt assembly (BRD section 11, NFR-017, threat T-01 layer 1).
 *
 * Two properties matter here and both are structural:
 *
 * 1. Email content is placed inside explicit delimiters in the USER message and is never
 *    concatenated into the instruction section. Instructions and data never share a lane.
 * 2. The scenario catalogue, and therefore the set of labels the model may return, comes from
 *    configuration. A scenario added in Dataverse is offered to the model without a code change.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NormalisedEmail, SenderType } from '../common/types.js';
import type { ResponseTemplateConfig, ScenarioConfig } from '../configuration/types.js';
import { sanitiseContent } from '../email/sanitizer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROMPT_DIR = resolve(HERE, '../../prompts');

export const CONTENT_START = '<<<EMAIL_CONTENT_START>>>';
export const CONTENT_END = '<<<EMAIL_CONTENT_END>>>';

export interface PromptFile {
  readonly name: string;
  readonly version: string;
  readonly systemPrompt: string;
}

/** Front-matter carries the semver written to ClassificationResult for reproducibility. */
export function parsePromptFile(raw: string, fallbackName: string): PromptFile {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!fm) return { name: fallbackName, version: '0.0.0', systemPrompt: raw.trim() };

  const [, frontMatter, bodyText] = fm;
  const name = /^name:\s*(.+)$/m.exec(frontMatter ?? '')?.[1]?.trim() ?? fallbackName;
  const version = /^version:\s*(.+)$/m.exec(frontMatter ?? '')?.[1]?.trim() ?? '0.0.0';

  // The file documents itself with "# System prompt" and "# User message template" sections; only
  // the system-prompt section is sent as the system message.
  const body = bodyText ?? '';
  const systemStart = /^#\s*System prompt\s*$/m.exec(body);
  const systemEnd = /^#\s*User message template\s*$/m.exec(body);
  const systemPrompt =
    systemStart && systemEnd
      ? body.slice(systemStart.index + systemStart[0].length, systemEnd.index).trim()
      : body.trim();

  return { name, version, systemPrompt };
}

export class PromptLoader {
  private readonly cache = new Map<string, PromptFile>();

  constructor(private readonly promptDir: string = DEFAULT_PROMPT_DIR) {}

  async load(fileName: string): Promise<PromptFile> {
    const cached = this.cache.get(fileName);
    if (cached) return cached;
    const raw = await readFile(resolve(this.promptDir, fileName), 'utf8');
    const parsed = parsePromptFile(raw, fileName);
    this.cache.set(fileName, parsed);
    return parsed;
  }
}

/** Rendered into the classifier's {{SCENARIO_CATALOGUE}} placeholder. */
export function buildScenarioCatalogue(scenarios: readonly ScenarioConfig[]): string {
  return scenarios
    .map((s) => {
      const lines = [
        `### ${s.scenarioId} - ${s.scenarioName}`,
        s.description,
        s.keywords.length > 0 ? `Evidence vocabulary: ${s.keywords.join('; ')}` : null,
        s.subIntents.length > 0 ? `Requires subIntent, one of: ${s.subIntents.join(' | ')}` : null,
        s.positiveExamples.length > 0 ? `Belongs here:\n${s.positiveExamples.map((e) => `  - ${e}`).join('\n')}` : null,
        s.negativeExamples.length > 0 ? `Does NOT belong here:\n${s.negativeExamples.map((e) => `  - ${e}`).join('\n')}` : null,
      ].filter(Boolean);
      return lines.join('\n');
    })
    .join('\n\n');
}

export function buildTemplateCatalogue(templates: readonly ResponseTemplateConfig[]): string {
  const active = templates.filter((t) => t.isActive);
  if (active.length === 0) {
    // Honest and useful: the selector is told there is nothing to choose, so it returns null and
    // the item goes to a human rather than proposing a template that could never be sent (GAP-004).
    return '(no active templates - every template is awaiting approved wording)';
  }
  return active
    .map((t) => `${t.templateId} | ${t.scenarioId} | ${t.program} | ${t.senderType} | ${t.templateType}`)
    .join('\n');
}

export interface UserMessageContext {
  readonly email: NormalisedEmail;
  readonly attachmentSummary: string;
  readonly senderDomainType: 'internal' | 'external';
}

/**
 * Build the user message. The content block is sanitised again here even though the normaliser
 * already sanitised it - this function is the last thing before the model, and a second pass costs
 * nothing next to the cost of being wrong.
 */
export function buildClassifierUserMessage(ctx: UserMessageContext): string {
  const { email } = ctx;
  const thread =
    email.threadContext.length === 0
      ? '(none)'
      : email.threadContext
          .slice(0, 5)
          .map((m) => `- ${m.receivedDateTime} from ${m.from}: ${sanitiseContent(m.subject)}`)
          .join('\n');

  return [
    `Attachments present: ${ctx.attachmentSummary}`,
    `Sender domain type: ${ctx.senderDomainType}`,
    'Thread context (most recent first, may be empty):',
    thread,
    '',
    CONTENT_START,
    `Subject: ${sanitiseContent(email.subject)}`,
    '',
    sanitiseContent(email.body),
    CONTENT_END,
    '',
    'Classify the email above. Return only the JSON object.',
  ].join('\n');
}

export interface ValidatorPromptContext {
  readonly email: NormalisedEmail;
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly program: string;
  readonly subIntent: string | null;
  readonly multiIntent: boolean;
  readonly confidence: number;
  readonly secondaryIntents: readonly { readonly scenarioId: string; readonly confidence: number }[];
}

/**
 * User message for the routing_decision_validator (prompt 5).
 *
 * The proposed decision goes in the instruction lane; the email stays inside the content
 * delimiters, sanitised, exactly as it does for the classifier. A validator that could be steered
 * by the email it is reviewing would be worse than no validator at all.
 */
export function buildValidatorUserMessage(ctx: ValidatorPromptContext): string {
  const secondary =
    ctx.secondaryIntents.length === 0
      ? '(none)'
      : ctx.secondaryIntents.map((s) => `${s.scenarioId} (${s.confidence.toFixed(2)})`).join(', ');

  return [
    'Proposed decision:',
    `  scenarioId:  ${ctx.scenarioId} (${ctx.scenarioName})`,
    `  programme:   ${ctx.program}`,
    `  subIntent:   ${ctx.subIntent ?? 'none'}`,
    `  multiIntent: ${ctx.multiIntent}`,
    `  confidence:  ${ctx.confidence.toFixed(2)}`,
    `  secondary intents: ${secondary}`,
    '',
    CONTENT_START,
    `Subject: ${sanitiseContent(ctx.email.subject)}`,
    '',
    sanitiseContent(ctx.email.body),
    CONTENT_END,
    '',
    'Review the proposed decision above. Return only the JSON object.',
  ].join('\n');
}

export function renderSystemPrompt(
  prompt: PromptFile,
  substitutions: Readonly<Record<string, string>>,
): string {
  let out = prompt.systemPrompt;
  for (const [key, value] of Object.entries(substitutions)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

export function senderDomainType(email: NormalisedEmail, internalDomains: readonly string[]): 'internal' | 'external' {
  const domain = email.senderDomain.toLowerCase();
  return internalDomains.some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`))
    ? 'internal'
    : 'external';
}

export type { SenderType };
