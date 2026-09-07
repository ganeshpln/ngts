/**
 * ConfigurationStore backed by the versioned JSON seed in /config.
 *
 * Used by the test suite and for offline runs. The Dataverse implementation
 * (src/configuration/dataverseConfigurationStore.ts) satisfies the same interface, so the engine
 * behaves identically against either.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AiConfig,
  AttachmentConfig,
  ConfigurationStore,
  FeatureFlags,
  MultiIntentConfig,
  RegionMappingConfig,
  ReportingConfig,
  ResponseTemplateConfig,
  RetryConfig,
  RoutingRuleConfig,
  SafetyConfig,
  ScenarioConfig,
  SenderTypeConfig,
  ThresholdConfig,
} from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_DIR = resolve(HERE, '../../config');

interface RawFeatureFlag {
  value: boolean;
  unblockedBy?: string;
  description?: string;
}

/** application.json stores each flag as an object carrying the gap that unblocks it. */
function flattenFeatureFlags(raw: Record<string, RawFeatureFlag>): FeatureFlags {
  const get = (key: string): boolean => raw[key]?.value === true;
  return {
    shadowMode: get('shadowMode'),
    sendResponsesEnabled: get('sendResponsesEnabled'),
    forwardingEnabled: get('forwardingEnabled'),
    moveEnabled: get('moveEnabled'),
    markAsReadEnabled: get('markAsReadEnabled'),
    deleteEnabled: get('deleteEnabled'),
    changeRequestRoutingEnabled: get('changeRequestRoutingEnabled'),
    externalRecipientsEnabled: get('externalRecipientsEnabled'),
    attachmentContentHandlers: get('attachmentContentHandlers'),
    ownerResponseSuppressionEnabled: get('ownerResponseSuppressionEnabled'),
  };
}

export class JsonConfigurationStore implements ConfigurationStore {
  private cache = new Map<string, unknown>();

  constructor(private readonly configDir: string = DEFAULT_CONFIG_DIR) {}

  private async load<T>(file: string): Promise<T> {
    const cached = this.cache.get(file);
    if (cached !== undefined) return cached as T;
    const content = await readFile(resolve(this.configDir, file), 'utf8');
    const parsed = JSON.parse(content) as T;
    this.cache.set(file, parsed);
    return parsed;
  }

  /** Overrides applied in-memory - used by tests to exercise a flag without editing the seed. */
  async override(file: string, mutate: (doc: any) => void): Promise<void> {
    const doc = await this.load<any>(file);
    mutate(doc);
    this.cache.set(file, doc);
  }

  async getScenarios(): Promise<readonly ScenarioConfig[]> {
    const doc = await this.load<{ scenarios: ScenarioConfig[] }>('scenarios.json');
    return doc.scenarios.filter((s) => s.isActive);
  }

  async getScenario(scenarioId: string): Promise<ScenarioConfig | undefined> {
    return (await this.getScenarios()).find((s) => s.scenarioId === scenarioId);
  }

  async getRoutingRules(): Promise<readonly RoutingRuleConfig[]> {
    const doc = await this.load<{ routingRules: RoutingRuleConfig[] }>('routing-rules.json');
    return doc.routingRules.filter((r) => r.isActive);
  }

  async getMultiIntentConfig(): Promise<MultiIntentConfig> {
    const doc = await this.load<{ multiIntent: MultiIntentConfig }>('routing-rules.json');
    return doc.multiIntent;
  }

  async getTemplates(): Promise<readonly ResponseTemplateConfig[]> {
    const doc = await this.load<{ templates: ResponseTemplateConfig[] }>('response-templates.json');
    return doc.templates;
  }

  async getThresholds(): Promise<ThresholdConfig> {
    return this.load<ThresholdConfig>('thresholds.json');
  }

  async getFeatureFlags(): Promise<FeatureFlags> {
    const doc = await this.load<{ features: Record<string, RawFeatureFlag> }>('application.json');
    return flattenFeatureFlags(doc.features);
  }

  async getSafetyConfig(): Promise<SafetyConfig> {
    const doc = await this.load<{ safety: SafetyConfig }>('application.json');
    return doc.safety;
  }

  async getAttachmentConfig(): Promise<AttachmentConfig> {
    const doc = await this.load<{ attachments: AttachmentConfig }>('application.json');
    return doc.attachments;
  }

  async getRetryConfig(): Promise<RetryConfig> {
    const doc = await this.load<{ retry: RetryConfig }>('application.json');
    return doc.retry;
  }

  async getReportingConfig(): Promise<ReportingConfig> {
    const doc = await this.load<{ reporting: ReportingConfig }>('application.json');
    return doc.reporting;
  }

  async getSenderTypeConfig(): Promise<SenderTypeConfig> {
    const doc = await this.load<{ senderTypes: SenderTypeConfig }>('application.json');
    return doc.senderTypes;
  }

  async getAiConfig(): Promise<AiConfig> {
    const doc = await this.load<{ ai: AiConfig }>('application.json');
    return doc.ai;
  }

  async getRegionMappings(): Promise<readonly RegionMappingConfig[]> {
    const doc = await this.load<{ mappings: RegionMappingConfig[] }>('region-mapping.json');
    // Ships empty by design (GAP-012). An empty list is a valid, expected state.
    return doc.mappings.filter((m) => m.isActive);
  }
}
