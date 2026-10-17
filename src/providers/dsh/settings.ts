import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey, getLegacyHostnameKey, migrateLegacyHostnameKeyedMap } from '../../utils/env';
import { type DshModel, isDshModelId, normalizeDshModels } from './models';

export interface DshProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  environmentVariables: string;
  environmentHash: string;
  startupTimeoutMs: number;
  models: DshModel[];
  selectedModel?: string;
}

export const DEFAULT_DSH_PROVIDER_SETTINGS: Readonly<DshProviderSettings> = Object.freeze({
  enabled: false,
  cliPath: '',
  cliPathsByHost: {},
  environmentVariables: '',
  environmentHash: '',
  startupTimeoutMs: 90_000,
  models: [],
});

export function getDshProviderSettings(settings: Record<string, unknown>): DshProviderSettings {
  const config = getProviderConfig(settings, 'dsh');
  const paths: HostnameCliPaths = {};
  if (config.cliPathsByHost && typeof config.cliPathsByHost === 'object' && !Array.isArray(config.cliPathsByHost)) {
    for (const [host, path] of Object.entries(config.cliPathsByHost)) {
      if (typeof path === 'string' && path.trim()) paths[host] = path.trim();
    }
  }
  const result: DshProviderSettings = {
    enabled: config.enabled === true,
    cliPath: typeof config.cliPath === 'string' ? config.cliPath.trim() : '',
    cliPathsByHost: migrateLegacyHostnameKeyedMap(paths, getHostnameKey(), getLegacyHostnameKey()),
    environmentVariables: typeof config.environmentVariables === 'string' ? config.environmentVariables : '',
    environmentHash: typeof config.environmentHash === 'string' ? config.environmentHash : '',
    startupTimeoutMs: typeof config.startupTimeoutMs === 'number'
      && Number.isFinite(config.startupTimeoutMs) && config.startupTimeoutMs >= 1_000 && config.startupTimeoutMs <= 600_000
      ? Math.floor(config.startupTimeoutMs) : DEFAULT_DSH_PROVIDER_SETTINGS.startupTimeoutMs,
    models: normalizeDshModels(config.models),
  };
  if (typeof config.selectedModel === 'string' && isDshModelId(config.selectedModel)) {
    result.selectedModel = config.selectedModel;
  }
  return result;
}

export function updateDshProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<DshProviderSettings>,
): DshProviderSettings {
  const config = getProviderConfig(settings, 'dsh');
  const temporary = { providerConfigs: { dsh: { ...config, ...updates } } };
  const normalized = getDshProviderSettings(temporary);
  const next: Record<string, unknown> = { ...config, ...normalized };
  if (!normalized.selectedModel) delete next.selectedModel;
  setProviderConfig(settings, 'dsh', next);
  return normalized;
}
