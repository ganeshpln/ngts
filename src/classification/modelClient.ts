/**
 * Azure OpenAI client (INT-05) behind a port.
 *
 * The port is what lets the scenario suite run the real decision pipeline against scripted
 * classifications - deterministic, offline and free - while production uses the HTTP adapter.
 *
 * Authentication is by Managed Identity: a token provider is injected, and no key ever appears in
 * configuration or source (NFR-009, NFR-010, Rule 4).
 */

import { categoriseHttpStatus, permanent, transient, type ProcessingFailure } from '../common/errors.js';
import { err, ok, type Result } from '../common/result.js';
import { withRetry, withTimeout, type RetryPolicy } from '../common/retry.js';

export interface ModelRequest {
  readonly systemPrompt: string;
  readonly userMessage: string;
  readonly promptName: string;
  readonly promptVersion: string;
  readonly maxTokens: number;
  readonly temperature: number;
}

export interface ModelResponse {
  readonly content: string;
  readonly latencyMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly modelName: string;
  readonly modelVersion: string;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<Result<ModelResponse, ProcessingFailure>>;
}

export interface AzureOpenAiOptions {
  readonly endpoint: string;
  readonly deployment: string;
  readonly apiVersion: string;
  readonly retryPolicy: RetryPolicy;
  /** Supplies a Managed Identity bearer token for https://cognitiveservices.azure.com/.default. */
  readonly getAccessToken: () => Promise<string>;
  readonly fetchImpl?: typeof fetch;
}

interface HttpFailure {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly body: string;
}

class HttpError extends Error {
  constructor(public readonly failure: HttpFailure) {
    super(`Azure OpenAI returned HTTP ${failure.status}`);
    this.name = 'HttpError';
  }
}

export class AzureOpenAiClient implements ModelClient {
  constructor(private readonly options: AzureOpenAiOptions) {}

  async complete(request: ModelRequest): Promise<Result<ModelResponse, ProcessingFailure>> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url =
      `${this.options.endpoint.replace(/\/$/, '')}/openai/deployments/` +
      `${encodeURIComponent(this.options.deployment)}/chat/completions` +
      `?api-version=${encodeURIComponent(this.options.apiVersion)}`;

    const started = Date.now();
    try {
      const outcome = await withRetry(
        async () => {
          const token = await this.options.getAccessToken();
          return withTimeout(async (signal) => {
            const response = await fetchImpl(url, {
              method: 'POST',
              signal,
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                messages: [
                  { role: 'system', content: request.systemPrompt },
                  { role: 'user', content: request.userMessage },
                ],
                temperature: request.temperature,
                max_tokens: request.maxTokens,
                response_format: { type: 'json_object' },
              }),
            });

            if (!response.ok) {
              const retryAfter = response.headers.get('retry-after');
              throw new HttpError({
                status: response.status,
                retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined,
                body: (await response.text()).slice(0, 500),
              });
            }
            return (await response.json()) as {
              choices?: { message?: { content?: string } }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
              model?: string;
            };
          }, this.options.retryPolicy.timeoutMs);
        },
        this.options.retryPolicy,
        (error) => {
          if (error instanceof HttpError) {
            return {
              category: categoriseHttpStatus(error.failure.status),
              retryAfterSeconds: error.failure.retryAfterSeconds,
            };
          }
          // AbortError (timeout) and network failures are transient by nature.
          return { category: 'Transient' };
        },
      );

      const content = outcome.value.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        return err(permanent('AI_EMPTY_RESPONSE', 'Model returned no content.', 'Classify'));
      }

      return ok({
        content,
        latencyMs: Date.now() - started,
        promptTokens: outcome.value.usage?.prompt_tokens ?? 0,
        completionTokens: outcome.value.usage?.completion_tokens ?? 0,
        modelName: outcome.value.model ?? this.options.deployment,
        modelVersion: this.options.apiVersion,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        const category = categoriseHttpStatus(error.failure.status);
        const make = category === 'Transient' ? transient : permanent;
        return err(
          make('AI_HTTP_ERROR', `Azure OpenAI returned HTTP ${error.failure.status}.`, 'Classify', {
            status: error.failure.status,
          }),
        );
      }
      return err(
        transient('AI_CALL_FAILED', error instanceof Error ? error.message : 'Unknown model call failure.', 'Classify'),
      );
    }
  }
}

/** Test double: returns scripted responses keyed by prompt name. */
export class ScriptedModelClient implements ModelClient {
  readonly calls: ModelRequest[] = [];

  constructor(private readonly responses: Map<string, string | ProcessingFailure>) {}

  async complete(request: ModelRequest): Promise<Result<ModelResponse, ProcessingFailure>> {
    this.calls.push(request);
    const scripted = this.responses.get(request.promptName);
    if (scripted === undefined) {
      return err(permanent('AI_NO_SCRIPT', `No scripted response for prompt "${request.promptName}".`, 'Classify'));
    }
    if (typeof scripted !== 'string') return err(scripted);
    return ok({
      content: scripted,
      latencyMs: 1,
      promptTokens: 0,
      completionTokens: 0,
      modelName: 'scripted',
      modelVersion: 'test',
    });
  }
}
