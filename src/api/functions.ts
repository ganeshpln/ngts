/**
 * Azure Functions v4 binding.
 *
 * A thin adapter over src/api/handlers.ts. Authentication is enforced by the platform
 * (authLevel 'anonymous' here means "no function key"; the Function App is configured with Entra
 * ID Easy Auth, so an unauthenticated request never reaches this code - see
 * docs/security-design.md section 1 and the Bicep module).
 */

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';

import { Orchestrator } from '../agent/orchestrator.js';
import { AzureOpenAiClient } from '../classification/modelClient.js';
import { PromptLoader } from '../classification/promptBuilder.js';
import { ConsoleLogger } from '../common/logger.js';
import { JsonConfigurationStore } from '../configuration/jsonConfigurationStore.js';
import type { ProcessingStore } from '../email/idempotency.js';
import {
  handleActionResults,
  handleHealth,
  handleProcess,
  handleWeeklyReport,
  type HandlerDependencies,
} from './handlers.js';

/**
 * Environment configuration. Every value is supplied per environment; none is defaulted in code
 * (NFR-021), and no secret appears here - Azure OpenAI and Dataverse both use Managed Identity.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable "${name}" is not set.`);
  return value;
}

let cached: HandlerDependencies | null = null;

async function dependencies(): Promise<HandlerDependencies> {
  if (cached) return cached;

  const logger = new ConsoleLogger();
  const config = new JsonConfigurationStore();
  const retry = await config.getRetryConfig();
  const aiRetry = retry.dependencies.azureOpenAI ?? { maxAttempts: 2, timeoutMs: 30000 };

  const model = new AzureOpenAiClient({
    endpoint: requiredEnv('AZURE_OPENAI_ENDPOINT'),
    deployment: requiredEnv('AZURE_OPENAI_DEPLOYMENT'),
    apiVersion: requiredEnv('AZURE_OPENAI_API_VERSION'),
    retryPolicy: {
      maxAttempts: aiRetry.maxAttempts,
      timeoutMs: aiRetry.timeoutMs,
      baseDelayMs: retry.baseDelayMs,
      maxDelayMs: retry.maxDelayMs,
    },
    // Managed Identity token provider. Wired to @azure/identity at deployment; the indirection
    // keeps this module free of any credential material (Rule 4, NFR-010).
    getAccessToken: async () => {
      const { DefaultAzureCredential } = (await import('@azure/identity')) as {
        DefaultAzureCredential: new () => { getToken(scope: string): Promise<{ token: string } | null> };
      };
      const token = await new DefaultAzureCredential().getToken('https://cognitiveservices.azure.com/.default');
      if (!token) throw new Error('Failed to acquire a Managed Identity token for Azure OpenAI.');
      return token.token;
    },
  });

  // The Dataverse-backed ProcessingStore is supplied at deployment. Until it is wired, the service
  // refuses to run rather than silently processing without idempotency protection.
  const processingStore = await loadProcessingStore();

  const orchestrator = new Orchestrator({
    config,
    model,
    processingStore,
    promptLoader: new PromptLoader(),
    logger,
    mailboxAddress: process.env.SPA_MAILBOX_UPN ?? null,
  });

  cached = { orchestrator, config, logger };
  return cached;
}

async function loadProcessingStore(): Promise<ProcessingStore> {
  const modulePath = process.env.PROCESSING_STORE_MODULE;
  if (!modulePath) {
    throw new Error(
      'PROCESSING_STORE_MODULE is not configured. The service will not process mail without an ' +
        'idempotency store, because duplicate processing cannot be prevented without one (FR-070).',
    );
  }
  const loaded = (await import(modulePath)) as { createProcessingStore: () => ProcessingStore };
  return loaded.createProcessingStore();
}

async function readJson(request: HttpRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function respond(result: { status: number; body: unknown }): HttpResponseInit {
  return { status: result.status, jsonBody: result.body };
}

app.http('process', {
  route: 'process',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    context.log('process invoked');
    return respond(await handleProcess(await dependencies(), await readJson(request)));
  },
});

app.http('actionResults', {
  route: 'actions/result',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> =>
    respond(await handleActionResults(await dependencies(), await readJson(request))),
});

app.http('weeklyReport', {
  route: 'reports/weekly',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> =>
    respond(await handleWeeklyReport(await dependencies(), await readJson(request))),
});

app.http('health', {
  route: 'health',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (): Promise<HttpResponseInit> => respond(await handleHealth(await dependencies())),
});
