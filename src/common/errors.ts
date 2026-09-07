/**
 * Error taxonomy. The category drives retry behaviour (NFR-001) and whether an item is retried,
 * failed, or treated as a guardrail violation.
 */

export type ErrorCategory = 'Transient' | 'Permanent' | 'Guardrail';

export type ProcessingStage =
  | 'Ingest'
  | 'Normalise'
  | 'Guard'
  | 'Classify'
  | 'Decide'
  | 'Validate'
  | 'Execute'
  | 'Audit'
  | 'Report'
  | 'Configuration';

export interface ProcessingFailure {
  readonly code: string;
  readonly message: string;
  readonly category: ErrorCategory;
  readonly stage: ProcessingStage;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
}

export function failure(
  code: string,
  message: string,
  category: ErrorCategory,
  stage: ProcessingStage,
  details?: Record<string, unknown>,
): ProcessingFailure {
  return { code, message, category, stage, retryable: category === 'Transient', details };
}

export function transient(code: string, message: string, stage: ProcessingStage, details?: Record<string, unknown>) {
  return failure(code, message, 'Transient', stage, details);
}

export function permanent(code: string, message: string, stage: ProcessingStage, details?: Record<string, unknown>) {
  return failure(code, message, 'Permanent', stage, details);
}

/** A control was violated - never retried, always escalated (HIL-09). */
export function guardrail(code: string, message: string, stage: ProcessingStage, details?: Record<string, unknown>) {
  return failure(code, message, 'Guardrail', stage, details);
}

/** HTTP status classification shared by the Graph, Dataverse and Azure OpenAI clients. */
export function categoriseHttpStatus(status: number): ErrorCategory {
  if (status === 408 || status === 429 || status >= 500) return 'Transient';
  return 'Permanent';
}
