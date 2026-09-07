/**
 * Structured logging carrying the NFR-005 field set.
 *
 * Every record passes through redaction (NFR-007). The `Logger` interface is what domain modules
 * depend on; `ConsoleLogger` is the Azure Functions / Application Insights adapter and
 * `CapturingLogger` is the test double that makes the redaction tests assertable.
 */

import { redactObject } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** NFR-005 field set. */
export interface LogContext {
  readonly correlationId?: string;
  readonly processingId?: string;
  readonly messageIdHash?: string;
  readonly stage?: string;
  readonly scenarioId?: string;
  readonly program?: string;
  readonly confidence?: number;
  readonly confidenceBand?: string;
  readonly selectedAction?: string;
  readonly outcome?: string;
  readonly aiLatencyMs?: number;
  readonly aiStatus?: string;
  readonly promptVersion?: string;
  readonly retryCount?: number;
  readonly humanReviewReason?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
  readonly [key: string]: unknown;
}

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly context: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

abstract class BaseLogger implements Logger {
  constructor(protected readonly bound: LogContext = {}) {}

  protected build(level: LogLevel, message: string, context?: LogContext): LogRecord {
    const merged = { ...this.bound, ...(context ?? {}) };
    return {
      timestamp: new Date().toISOString(),
      level,
      // The message itself is redacted too: a developer interpolating a subject line into a
      // message is exactly the leak NFR-007 is about.
      message: redactObject(message) as string,
      context: redactObject(merged) as Record<string, unknown>,
    };
  }

  abstract write(record: LogRecord): void;

  debug(message: string, context?: LogContext): void { this.write(this.build('debug', message, context)); }
  info(message: string, context?: LogContext): void { this.write(this.build('info', message, context)); }
  warn(message: string, context?: LogContext): void { this.write(this.build('warn', message, context)); }
  error(message: string, context?: LogContext): void { this.write(this.build('error', message, context)); }

  abstract child(context: LogContext): Logger;
}

export class ConsoleLogger extends BaseLogger {
  override write(record: LogRecord): void {
    // Azure Functions forwards stdout to Application Insights as a trace with custom dimensions.
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
  override child(context: LogContext): Logger {
    return new ConsoleLogger({ ...this.bound, ...context });
  }
}

export class CapturingLogger extends BaseLogger {
  readonly records: LogRecord[] = [];
  constructor(bound: LogContext = {}, private readonly shared: LogRecord[] = []) {
    super(bound);
    this.records = shared;
  }
  override write(record: LogRecord): void { this.records.push(record); }
  override child(context: LogContext): Logger {
    return new CapturingLogger({ ...this.bound, ...context }, this.records);
  }
  /** Everything written, serialised - used by the telemetry-leakage tests. */
  serialised(): string { return JSON.stringify(this.records); }
}

export class NullLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger { return this; }
}
