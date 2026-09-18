import { createStandardCliResolverClass } from '../../../core/providers/CachedCliResolver';
import { getProviderConfig } from '../../../core/providers/providerConfig';
import {
  ANTIGRAVITY_BINARY_NAME,
  ANTIGRAVITY_PROVIDER_ID,
} from './AntigravityLaunchSpec';

export { ANTIGRAVITY_BINARY_NAME, ANTIGRAVITY_PROVIDER_ID };

export interface AntigravityCliSettings {
  cliPath: string;
  cliPathsByHost: Record<string, string>;
}

/**
 * Extracts the CLI-path projection from raw shared settings. Lives here until
 * the Antigravity settings module (roadmap A5a) lands; once it does, this can
 * delegate to the provider's normalized settings getter without changing the
 * resolver class.
 */
export function extractAntigravityCliSettings(
  settings: Record<string, unknown>,
): AntigravityCliSettings {
  const config = getProviderConfig(settings, ANTIGRAVITY_PROVIDER_ID);
  return {
    cliPath: typeof config.cliPath === 'string' ? config.cliPath : '',
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
  };
}

function normalizeHostnameCliPaths(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

/**
 * Standard cached CLI resolution for Antigravity: per-host path first, then the
 * legacy `cliPath`, then a PATH lookup for `agy`. Returns `null` when unresolved
 * (shared contract); convert to `AntigravityCliMissingError` via
 * `requireAntigravityCliPath` at the launch boundary.
 */
export const AntigravityCliResolver = createStandardCliResolverClass({
  providerId: ANTIGRAVITY_PROVIDER_ID,
  binaryName: ANTIGRAVITY_BINARY_NAME,
  getProviderSettings: extractAntigravityCliSettings,
});
