/**
 * Prompt-injection detection (T-01 layer 2, NFR-013, HIL-09).
 *
 * This is a signal, not the control. The control is that model output can never name a
 * destination (docs/ai-agent-design.md section 5, layer 4). Detection lowers confidence and raises
 * a human review flag; it is not relied upon to keep the system safe.
 */

export interface InjectionFinding {
  readonly pattern: string;
  readonly excerptHash: string;
}

export interface InjectionScanResult {
  readonly suspected: boolean;
  readonly findings: readonly InjectionFinding[];
}

interface NamedPattern {
  readonly name: string;
  readonly regex: RegExp;
}

const PATTERNS: readonly NamedPattern[] = [
  { name: 'instruction-override', regex: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all)\b[^.\n]{0,30}\b(instruction|prompt|rule|direction|context)/i },
  { name: 'role-reassignment', regex: /\byou are (now |no longer )?(a|an|the)\b[^.\n]{0,60}\b(assistant|agent|bot|system|admin|developer)\b/i },
  { name: 'system-prompt-request', regex: /\b(reveal|show|print|output|repeat|display)\b[^.\n]{0,40}\b(system prompt|your instructions|your rules|initial prompt|the prompt)\b/i },
  { name: 'forced-routing', regex: /\b(forward|send|route|redirect|cc|bcc)\b[^.\n]{0,40}\b(this|the)\b[^.\n]{0,20}\b(email|message)\b[^.\n]{0,20}\bto\b\s*[<[]?\s*[A-Za-z0-9._%+-]+@/i },
  { name: 'forced-reply-text', regex: /\b(reply|respond|answer)\b[^.\n]{0,30}\bwith\b[^.\n]{0,30}\b(the following|exactly|this text|verbatim)\b/i },
  { name: 'action-command', regex: /\b(delete|archive|mark as read|move)\b[^.\n]{0,25}\b(this|the)\b[^.\n]{0,15}\b(email|message|thread)\b[^.\n]{0,25}\b(immediately|now|without)\b/i },
  { name: 'tag-injection', regex: /<\|(im_start|im_end|system|user|assistant)\|>|\[\/?(INST|SYS)\]/i },
  { name: 'delimiter-escape', regex: /<<<\s*EMAIL_CONTENT_(START|END)\s*>>>/i },
  { name: 'confidence-manipulation', regex: /\b(set|report|return)\b[^.\n]{0,30}\bconfidence\b[^.\n]{0,20}\b(to|as|=)\b[^.\n]{0,10}(1|0?\.9|100)/i },
  { name: 'scenario-forcing', regex: /\b(classify|categorise|categorize|treat|mark)\b[^.\n]{0,30}\b(this|it)\b[^.\n]{0,25}\bas\b[^.\n]{0,20}\bSC-\d{2}\b/i },
  { name: 'urgency-social-engineering', regex: /\b(this is (an )?(admin|administrator|system|automated)\b[^.\n]{0,30}(instruction|command|message|override))/i },
];

import { sha256 } from '../common/hash.js';

/**
 * Scan combined subject and body. Findings carry a hash of the matched excerpt rather than the
 * excerpt itself, so an injection attempt is auditable without echoing attacker-controlled text
 * into telemetry (NFR-007).
 */
export function scanForInjection(subject: string, body: string): InjectionScanResult {
  const haystack = `${subject ?? ''}\n${body ?? ''}`;
  const findings: InjectionFinding[] = [];

  for (const { name, regex } of PATTERNS) {
    const match = regex.exec(haystack);
    if (match) {
      findings.push({ pattern: name, excerptHash: sha256(match[0]).slice(0, 16) });
    }
  }

  return { suspected: findings.length > 0, findings };
}
