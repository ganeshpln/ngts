/** Shapes of the business configuration in /config (seed) and Dataverse (runtime). */

import type { ActionType, Program, RoutingTarget, SenderType, SubIntent } from '../common/types.js';

export interface EscalationRule {
  readonly enabled: boolean;
  readonly escalateWhen: readonly string[];
  readonly escalateTo: string | null;
  readonly waitHours: number | null;
}

export interface ScenarioConfig {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly brdReference: string;
  readonly intent: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly positiveExamples: readonly string[];
  readonly negativeExamples: readonly string[];
  readonly programScope: 'FIT_FLO' | 'MEC_CGR' | 'ANY';
  readonly requiresProgram: boolean;
  readonly allowedActions: readonly ActionType[];
  /** Rule 14 gate: silence is not permission (AD-002). */
  readonly sendResponseAllowed: boolean;
  /** Rule 15 gate: true for SC-08 only. */
  readonly deleteAllowed: boolean;
  readonly precedence: number;
  readonly confidenceThresholdOverride?: number | null;
  readonly subIntents: readonly string[];
  readonly escalationRule: EscalationRule;
  readonly isActive: boolean;
}

export interface RoutingRuleConfig {
  readonly ruleId: string;
  readonly scenarioId: string;
  readonly program: Program | 'ALL';
  readonly subIntent: string | null;
  readonly ownerName: string | null;
  /** The ONLY source of routing addresses (Rule 16). */
  readonly ownerEmails: readonly string[];
  readonly routingTarget: RoutingTarget;
  readonly destinationFolder: string | null;
  readonly responseTemplateId: string | null;
  readonly actionPlan: readonly ActionType[];
  readonly confidenceThreshold: number | null;
  readonly priority: number;
  readonly brdReference: string;
  readonly isActive: boolean;
  readonly note?: string;
}

export interface MultiIntentRuleConfig {
  readonly id: string;
  readonly when: Record<string, unknown>;
  readonly outcome: 'SINGLE' | 'EXECUTE_BOTH' | 'HUMAN_REVIEW';
  readonly primary?: string;
  readonly note?: string;
}

export interface MultiIntentConfig {
  readonly precedence: readonly string[];
  readonly rules: readonly MultiIntentRuleConfig[];
}

export interface ResponseTemplateConfig {
  readonly templateId: string;
  readonly scenarioId: string;
  readonly program: Program | 'ALL';
  readonly senderType: SenderType | 'any';
  readonly templateType: 'Acknowledgement' | 'Troubleshooting' | 'ChangeRequest' | 'Escalation';
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  /** BRD section 16: only approved variables may be populated. */
  readonly allowedVariables: readonly string[];
  readonly isActive: boolean;
  readonly version: string;
  readonly effectiveDate: string | null;
  readonly lastModifiedDate: string;
  readonly approvedBy: string | null;
  readonly gap?: string;
}

export interface ConfidenceThresholds {
  readonly highThreshold: number;
  readonly mediumThreshold: number;
}

export interface ThresholdConfig {
  readonly confidence: ConfidenceThresholds & {
    readonly scenarioOverrides: Readonly<Record<string, ConfidenceThresholds>>;
    readonly destructiveActionMinimumBand: 'HIGH' | 'MEDIUM' | 'LOW';
    readonly destructiveActions: readonly ActionType[];
  };
  readonly penalties: {
    readonly noCorroboratingSignal: number;
    readonly shortContent: number;
    readonly nonEnglishContent: number;
    readonly injectionSuspected: number;
    readonly invalidEntityFormat: number;
  };
  readonly shortContentCharThreshold: number;
  readonly programEvidence: {
    readonly programConfidenceThreshold: number;
    readonly weights: Readonly<Record<string, number>>;
    readonly genericKeywordOnlyCeiling: number;
  };
  readonly corroboration: {
    readonly requiredForMediumBand: boolean;
    readonly minimumSignalMatches: number;
    readonly requireValidatorAgreementForMultiIntent: boolean;
  };
}

/** Flattened from application.json, where each flag is an object carrying its unblocking gap. */
export interface FeatureFlags {
  readonly shadowMode: boolean;
  readonly sendResponsesEnabled: boolean;
  readonly forwardingEnabled: boolean;
  readonly moveEnabled: boolean;
  readonly markAsReadEnabled: boolean;
  readonly deleteEnabled: boolean;
  readonly changeRequestRoutingEnabled: boolean;
  readonly externalRecipientsEnabled: boolean;
  readonly attachmentContentHandlers: boolean;
  readonly ownerResponseSuppressionEnabled: boolean;
}

export interface SafetyConfig {
  readonly botHeaderName: string;
  readonly botIdentities: readonly string[];
  readonly allowedRecipientDomains: readonly string[];
  readonly maxOutboundPerConversation: number;
  readonly maxBodyChars: number;
  readonly maxSubjectChars: number;
  readonly maxReasoningSummaryChars: number;
  readonly hardDeleteEnabled: boolean;
  readonly storeBodyPreview: boolean;
  readonly ownerResponseSuppression: {
    readonly scope: 'conversation' | 'sender';
    readonly expiryHours: number | null;
    readonly ownerAddresses: readonly string[];
  };
  readonly rateLimits: {
    readonly maxMessagesPerSenderPerHour: number;
    readonly maxMessagesPerConversationPerHour: number;
  };
}

export interface AttachmentConfig {
  readonly supportedExtensions: readonly string[];
  readonly supportedMimeTypes: readonly string[];
  readonly maxSizeBytes: number;
  readonly ignoreInlineImages: boolean;
  readonly screenshotExtensions: readonly string[];
}

export interface RetryConfig {
  readonly defaultMaxAttempts: number;
  readonly defaultTimeoutMs: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter: string;
  readonly sweepIntervalMinutes: number;
  readonly claimLeaseMinutes: number;
  readonly dependencies: Readonly<Record<string, { readonly maxAttempts: number; readonly timeoutMs: number }>>;
}

export interface ReportingConfig {
  readonly timezone: string | null;
  readonly fridayReportHourLocal: number | null;
  readonly recipients: readonly string[];
  readonly unmappedRegionCode: string;
  readonly includeUnmappedCountInReport: boolean;
}

export interface RegionMappingConfig {
  readonly matchType: 'SenderDomain' | 'SenderAddress' | 'LearnerLocation' | 'DistributionList' | 'Custom';
  readonly matchValue: string;
  readonly regionCode: string;
  readonly regionName: string;
  readonly priority: number;
  readonly isActive: boolean;
}

export interface SenderTypeConfig {
  readonly values: readonly SenderType[];
  readonly internalDomains: readonly string[];
  readonly defaultWhenUndetermined: SenderType;
}

export interface AiConfig {
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly repairAttempts: number;
  readonly prompts: Readonly<Record<string, { readonly file: string; readonly version: string }>>;
}

/**
 * The single interface the engine depends on. Two implementations - JSON seed (tests, offline) and
 * Dataverse (runtime) - so the decision path is byte-identical in test and production.
 */
export interface ConfigurationStore {
  getScenarios(): Promise<readonly ScenarioConfig[]>;
  getScenario(scenarioId: string): Promise<ScenarioConfig | undefined>;
  getRoutingRules(): Promise<readonly RoutingRuleConfig[]>;
  getMultiIntentConfig(): Promise<MultiIntentConfig>;
  getTemplates(): Promise<readonly ResponseTemplateConfig[]>;
  getThresholds(): Promise<ThresholdConfig>;
  getFeatureFlags(): Promise<FeatureFlags>;
  getSafetyConfig(): Promise<SafetyConfig>;
  getAttachmentConfig(): Promise<AttachmentConfig>;
  getRetryConfig(): Promise<RetryConfig>;
  getReportingConfig(): Promise<ReportingConfig>;
  getRegionMappings(): Promise<readonly RegionMappingConfig[]>;
  getSenderTypeConfig(): Promise<SenderTypeConfig>;
  getAiConfig(): Promise<AiConfig>;
}

export type SubIntentValue = SubIntent;
