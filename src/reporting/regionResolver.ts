/**
 * Region resolution for reporting (FR-090, FR-091, FR-096, FR-097).
 *
 * REQUIREMENT GAP GAP-012 / Q-06: the BRD states region logic is "To be Provided by Amy". The
 * mapping table ships EMPTY and this module must never invent one. Unmatched messages resolve to
 * the configured UNMAPPED code, and the weekly report states how many that was - so the missing
 * mapping stays visible to the business every week rather than quietly degrading.
 */

import type { NormalisedEmail } from '../common/types.js';
import type { RegionMappingConfig, ReportingConfig } from '../configuration/types.js';

export interface RegionResolution {
  readonly regionCode: string;
  readonly regionName: string | null;
  readonly matchedBy: RegionMappingConfig['matchType'] | null;
  readonly mapped: boolean;
}

export interface RegionResolutionInput {
  readonly email: NormalisedEmail;
  /** Supplied by the directory lookup when available (Graph G-10). */
  readonly learnerLocation?: string | null;
  readonly distributionLists?: readonly string[];
}

function matches(mapping: RegionMappingConfig, input: RegionResolutionInput): boolean {
  const value = mapping.matchValue.trim().toLowerCase();
  switch (mapping.matchType) {
    case 'SenderDomain': {
      const domain = input.email.senderDomain.toLowerCase();
      return domain === value || domain.endsWith(`.${value}`);
    }
    case 'SenderAddress':
      return input.email.senderEmail.toLowerCase() === value;
    case 'LearnerLocation':
      return (input.learnerLocation ?? '').trim().toLowerCase() === value;
    case 'DistributionList':
      return (input.distributionLists ?? []).some((dl) => dl.trim().toLowerCase() === value);
    case 'Custom':
      // Reserved for a strategy Business defines when answering Q-06. Never guesses.
      return false;
    default:
      return false;
  }
}

export function resolveRegion(
  mappings: readonly RegionMappingConfig[],
  reporting: ReportingConfig,
  input: RegionResolutionInput,
): RegionResolution {
  const unmapped: RegionResolution = {
    regionCode: reporting.unmappedRegionCode,
    regionName: null,
    matchedBy: null,
    mapped: false,
  };

  if (mappings.length === 0) return unmapped;

  const active = [...mappings].filter((m) => m.isActive).sort((a, b) => a.priority - b.priority);
  for (const mapping of active) {
    if (matches(mapping, input)) {
      return {
        regionCode: mapping.regionCode,
        regionName: mapping.regionName,
        matchedBy: mapping.matchType,
        mapped: true,
      };
    }
  }
  return unmapped;
}
