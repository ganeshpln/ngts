/**
 * Domain types shared across the Decision Service.
 *
 * These are the shapes that cross module boundaries. Keeping them in one place is what makes the
 * dependency rule in docs/component-design.md enforceable: the domain modules import from here and
 * from `configuration`, never from an adapter.
 */

// ---------------------------------------------------------------------------
// Enumerations - closed sets. Anything outside them is rejected, not coerced.
// ---------------------------------------------------------------------------

/** BRD section 1.5. UNKNOWN is a first-class value (FR-028), not a failure state. */
export const PROGRAMS = ['FIT', 'FLO', 'MEC_CGR', 'ALL', 'UNKNOWN'] as const;
export type Program = (typeof PROGRAMS)[number];

/** The approved action set (FR-040..FR-048). The AI may not extend it (FR-031, Rule 12). */
export const ACTION_TYPES = [
  'SendResponse',
  'ForwardEmail',
  'MoveEmail',
  'MarkAsRead',
  'DeleteEmail',
  'RouteToChangeRequest',
  'RouteToProgramOwner',
  'EscalateToHumanReview',
  'GenerateReport',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const CONFIDENCE_BANDS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export const ROUTING_TARGETS = [
  'PROGRAM_OWNER',
  'CHANGE_REQUEST',
  'SCHOOX_OWNER',
  'HUMAN_REVIEW',
  'NONE',
] as const;
export type RoutingTarget = (typeof ROUTING_TARGETS)[number];

export const SENDER_TYPES = [
  'learner',
  'manager',
  'peer_trainer',
  'hr',
  'internal',
  'external',
  'system',
  'unknown',
] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

export type SubIntent = 'change_request' | 'technical' | null;

/** Terminal outcomes of the pipeline. See the state machine in docs/data-model.md section 4. */
export type ProcessingOutcome =
  | 'EXECUTE'
  | 'SHADOW'
  | 'HUMAN_REVIEW'
  | 'SUPPRESS'
  | 'DUPLICATE';

/** BRD section 10 triggers, plus HIL-09 (AD-007). */
export type HumanReviewReason =
  | 'HIL-01' // low confidence
  | 'HIL-02' // conflicting scenarios
  | 'HIL-03' // FIT/FLO undeterminable and required
  | 'HIL-04' // routing owner unknown
  | 'HIL-05' // invalid AI output
  | 'HIL-06' // required information missing
  | 'HIL-07' // unexpected scenario (SC-99)
  | 'HIL-08' // repeated downstream failure
  | 'HIL-09'; // guardrail violation

export type SuppressionReason =
  | 'OwnerResponded'
  | 'SelfSent'
  | 'AutoReplyLoop'
  | 'ConversationCapExceeded'
  | 'RateLimited';

// ---------------------------------------------------------------------------
// Inbound message
// ---------------------------------------------------------------------------

export interface EmailAddress {
  readonly address: string;
  readonly name?: string;
}

export interface InternetMessageHeader {
  readonly name: string;
  readonly value: string;
}

export interface RawAttachment {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly isInline: boolean;
}

/** As received from Microsoft Graph (docs/integration-design.md G-01). Entirely untrusted. */
export interface RawEmail {
  readonly id: string;
  readonly internetMessageId: string;
  readonly conversationId: string;
  readonly conversationIndex?: string;
  readonly subject: string;
  readonly body: { readonly contentType: 'html' | 'text'; readonly content: string };
  readonly from: EmailAddress;
  readonly toRecipients: readonly EmailAddress[];
  readonly ccRecipients: readonly EmailAddress[];
  readonly receivedDateTime: string;
  readonly hasAttachments: boolean;
  readonly isRead: boolean;
  readonly internetMessageHeaders: readonly InternetMessageHeader[];
  readonly attachments: readonly RawAttachment[];
}

export interface ThreadMessage {
  readonly from: string;
  readonly receivedDateTime: string;
  readonly subject: string;
}

export interface AttachmentMetadata {
  readonly attachmentId: string;
  /** Sanitised - the raw filename is attacker-controlled text (T-04). */
  readonly fileName: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly isInline: boolean;
  readonly supported: boolean;
  readonly isScreenshot: boolean;
}

/** Output of the normaliser: HTML stripped, hidden content removed, history trimmed, capped. */
export interface NormalisedEmail {
  readonly messageId: string;
  readonly internetMessageId: string;
  readonly conversationId: string;
  readonly subject: string;
  readonly body: string;
  readonly bodyHash: string;
  readonly senderEmail: string;
  readonly senderName: string;
  readonly senderDomain: string;
  readonly toRecipients: readonly string[];
  readonly ccRecipients: readonly string[];
  readonly receivedDateTime: string;
  readonly attachments: readonly AttachmentMetadata[];
  readonly headers: ReadonlyMap<string, string>;
  readonly threadContext: readonly ThreadMessage[];
  readonly truncated: boolean;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface ExtractedEntities {
  readonly learnerName: string | null;
  readonly gpid: string | null;
  readonly email: string | null;
  readonly program: string | null;
  readonly island: string | null;
  readonly week: string | null;
  readonly errorMessage: string | null;
}

export interface SecondaryIntent {
  readonly scenarioId: string;
  readonly confidence: number;
  readonly subIntent?: SubIntent;
}

export type ProgramEvidenceSource =
  | 'explicitProgramMention'
  | 'businessRule'
  | 'programSpecificVocabulary'
  | 'threadHistory'
  | 'senderHistory'
  | 'genericKeyword';

export interface ProgramEvidence {
  readonly source: ProgramEvidenceSource;
  readonly detail?: string;
}

/**
 * The validated model output.
 *
 * `recommendedAction`, `routingOwner`, `routingEmail` and `destinationFolder` are present because
 * the BRD section 5 example defines them. They are recorded for audit and comparison and are then
 * DISCARDED from the decision path - the deterministic layer resolves the real values from
 * configuration (Rule 12, Rule 16). See docs/ai-agent-design.md section 4.
 */
export interface Classification {
  readonly processingId?: string;
  readonly scenarioId: string;
  readonly scenarioName?: string;
  readonly program: Program;
  readonly programEvidence?: readonly ProgramEvidence[];
  readonly intent: string;
  readonly subIntent?: SubIntent;
  readonly confidence: number;
  readonly senderType: SenderType;
  readonly requiresHumanReview: boolean;
  readonly multiIntent?: boolean;
  readonly secondaryIntents?: readonly SecondaryIntent[];
  readonly extractedEntities: ExtractedEntities;
  readonly missingRequiredInformation?: readonly string[];
  readonly recommendedAction?: ActionType | null;
  readonly routingOwner?: string | null;
  readonly routingEmail?: string | null;
  readonly destinationFolder?: string | null;
  readonly responseTemplateId?: string | null;
  readonly reasoningSummary: string;
  readonly injectionSuspected?: boolean;
  readonly languageDetected?: string | null;
}

export interface ConfidenceAssessment {
  readonly rawConfidence: number;
  readonly effectiveConfidence: number;
  readonly band: ConfidenceBand;
  readonly penaltiesApplied: readonly string[];
  readonly corroborated: boolean;
  readonly corroboratingSignals: readonly string[];
}

export interface ProgramResolution {
  readonly program: Program;
  readonly score: number;
  readonly resolvedBy: 'explicit' | 'evidence' | 'businessRule' | 'fallback' | 'conflict';
  /** Rule R-1 (FR-027): programme unknown, so route to BOTH Jordan and Josh. */
  readonly appliedFallbackRule: boolean;
  readonly conflicting: boolean;
}

export interface MultiIntentResolution {
  readonly multiIntent: boolean;
  readonly primaryScenarioId: string;
  readonly additionalScenarioIds: readonly string[];
  readonly ruleApplied: string | null;
  readonly requiresHumanReview: boolean;
  readonly reason: string | null;
}

// ---------------------------------------------------------------------------
// Decision and actions
// ---------------------------------------------------------------------------

export interface ActionParameters {
  readonly toRecipients?: readonly string[];
  readonly destinationFolder?: string;
  readonly templateId?: string;
  readonly subject?: string;
  readonly body?: string;
  readonly hardDelete?: boolean;
  readonly humanReviewReason?: HumanReviewReason;
  readonly [key: string]: unknown;
}

export interface ActionPlanItem {
  readonly sequence: number;
  readonly actionType: ActionType;
  readonly parameters: ActionParameters;
  /** The address or folder actually used - proves it came from configuration (Rule 16). */
  readonly resolvedDestination: string | null;
  readonly scenarioId: string;
}

export interface Decision {
  readonly processingId: string;
  readonly outcome: ProcessingOutcome;
  readonly classification: Classification;
  readonly programResolution: ProgramResolution;
  readonly multiIntentResolution: MultiIntentResolution;
  readonly confidence: ConfidenceAssessment;
  readonly actionPlan: readonly ActionPlanItem[];
  readonly humanReviewReason: HumanReviewReason | null;
  readonly suppressionReason: SuppressionReason | null;
  readonly regionCode: string;
  readonly warnings: readonly string[];
}

export interface ActionResult {
  readonly sequence: number;
  readonly actionType: ActionType;
  readonly status: 'Succeeded' | 'Failed' | 'Skipped' | 'Shadowed';
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly graphRequestId?: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export interface GuardVerdict {
  readonly blocked: boolean;
  readonly reason: SuppressionReason | null;
  readonly detail: string | null;
}

export function isProgram(value: unknown): value is Program {
  return typeof value === 'string' && (PROGRAMS as readonly string[]).includes(value);
}

export function isActionType(value: unknown): value is ActionType {
  return typeof value === 'string' && (ACTION_TYPES as readonly string[]).includes(value);
}

export function isSenderType(value: unknown): value is SenderType {
  return typeof value === 'string' && (SENDER_TYPES as readonly string[]).includes(value);
}
