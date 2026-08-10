import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import {
  getKimiDiscoveryState,
  seedKimiDiscoveryStateFromLegacyConfig,
  updateKimiDiscoveryState,
} from './discoveryState';
import {
  type KimiDiscoveredModel,
  normalizeKimiModelAliases,
  normalizeKimiVisibleModels,
  resolveKimiBaseModelRawId,
} from './models';

export interface PersistedKimiProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  modelAliases: Record<string, string>;
  visibleModels: string[];
}

export interface KimiProviderSettings extends PersistedKimiProviderSettings {
  discoveredModels: KimiDiscoveredModel[];
}

export const DEFAULT_KIMI_PROVIDER_SETTINGS: Readonly<PersistedKimiProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  visibleModels: [],
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

export function getKimiProviderSettings(
  settings: Record<string, unknown>,
): KimiProviderSettings {
  const config = getProviderConfig(settings, 'kimi');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;
  seedKimiDiscoveryStateFromLegacyConfig(settings, config);
  const discoveryState = getKimiDiscoveryState(settings);
  const discoveredModels = discoveryState.discoveredModels;

  return {
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_KIMI_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    discoveredModels,
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_KIMI_PROVIDER_SETTINGS.enabled,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_KIMI_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'kimi')
      ?? DEFAULT_KIMI_PROVIDER_SETTINGS.environmentVariables,
    modelAliases: normalizeKimiModelAliases(config.modelAliases, discoveredModels),
    visibleModels: normalizeKimiVisibleModels(config.visibleModels, discoveredModels),
  };
}

export function updateKimiProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<KimiProviderSettings>,
): KimiProviderSettings {
  const current = getKimiProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  if ('discoveredModels' in updates) {
    updateKimiDiscoveryState(settings, {
      ...(updates.discoveredModels !== undefined
        ? { discoveredModels: updates.discoveredModels }
        : {}),
    });
  }
  const nextDiscoveredModels = getKimiDiscoveryState(settings).discoveredModels;
  const nextVisibleModels = normalizeKimiVisibleModels(
    updates.visibleModels ?? current.visibleModels,
    nextDiscoveredModels,
  );
  const nextModelAliases = pruneKimiModelAliasesToVisible(
    normalizeKimiModelAliases(
      updates.modelAliases ?? current.modelAliases,
      nextDiscoveredModels,
    ),
    nextVisibleModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_KIMI_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_KIMI_PROVIDER_SETTINGS.cliPath;
  }

  const next: KimiProviderSettings = {
    ...current,
    ...updates,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    discoveredModels: nextDiscoveredModels,
    modelAliases: nextModelAliases,
    visibleModels: nextVisibleModels,
  };

  if (updates.visibleModels !== undefined) {
    retargetRemovedKimiSelections(settings, next);
  }

  setProviderConfig(settings, 'kimi', {
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    modelAliases: next.modelAliases,
    visibleModels: next.visibleModels,
  });

  return next;
}

export function hasLegacyKimiDiscoveryFields(settings: Record<string, unknown>): boolean {
  const config = getProviderConfig(settings, 'kimi');
  return 'discoveredModels' in config;
}

function pruneKimiModelAliasesToVisible(
  aliases: Record<string, string>,
  visibleModels: string[],
): Record<string, string> {
  if (visibleModels.length === 0 || Object.keys(aliases).length === 0) {
    return {};
  }

  const visibleSet = new Set(visibleModels);
  const pruned: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(aliases)) {
    if (visibleSet.has(rawId)) {
      pruned[rawId] = alias;
    }
  }
  return pruned;
}

function retargetRemovedKimiSelections(
  settings: Record<string, unknown>,
  next: KimiProviderSettings,
): void {
  if (next.visibleModels.length === 0) {
    return;
  }

  const visibleSet = new Set(next.visibleModels);
  const fallbackRawId = next.visibleModels[0];

  const maybeRetarget = (value: unknown): string | null => {
    if (typeof value !== 'string') {
      return null;
    }

    const baseRawId = resolveKimiBaseModelRawId(value, next.discoveredModels);
    if (!baseRawId) {
      return fallbackRawId;
    }

    return visibleSet.has(baseRawId) ? null : fallbackRawId;
  };

  const savedProviderModel = settings.savedProviderModel;
  if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
    const savedEntry = (savedProviderModel as Record<string, unknown>).kimi;
    const nextSavedModel = maybeRetarget(savedEntry);
    if (nextSavedModel) {
      (savedProviderModel as Record<string, unknown>).kimi = nextSavedModel;
    }
  }

  const nextTopLevelModel = maybeRetarget(settings.model);
  if (nextTopLevelModel) {
    settings.model = nextTopLevelModel;
  }
}
