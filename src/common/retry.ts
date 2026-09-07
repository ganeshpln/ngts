/**
 * Timeout, bounded retry and full-jitter exponential backoff (NFR-001).
 *
 * Full jitter rather than plain exponential: when Graph throttles the whole flow at once,
 * synchronised retries produce a thundering herd that keeps it throttled.
 */

import type { ErrorCategory } from './errors.js';

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface RetryOutcome<T> {
  readonly value: T;
  readonly attempts: number;
  readonly totalDelayMs: number;
}

export interface RetryableError {
  readonly category: ErrorCategory;
  /** Seconds, from a Retry-After header. Honoured exactly before any backoff is applied. */
  readonly retryAfterSeconds?: number;
}

export type Sleep = (ms: number) => Promise<void>;
export type Random = () => number;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function computeDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: Random = Math.random,
  retryAfterSeconds?: number,
): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, policy.maxDelayMs);
  }
  const exponential = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return Math.floor(random() * exponential); // full jitter
}

export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `operation` with retries. `isRetryable` decides from the thrown error; anything it rejects
 * fails immediately, because retrying a permanent error only delays the escalation.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  isRetryable: (error: unknown) => RetryableError | null,
  deps: { sleep?: Sleep; random?: Random } = {},
): Promise<RetryOutcome<T>> {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  let totalDelayMs = 0;
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return { value: await operation(attempt), attempts: attempt, totalDelayMs };
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error);
      if (!retryable || retryable.category !== 'Transient' || attempt === policy.maxAttempts) {
        throw error;
      }
      const delay = computeDelayMs(attempt, policy, random, retryable.retryAfterSeconds);
      totalDelayMs += delay;
      await sleep(delay);
    }
  }
  throw lastError;
}
