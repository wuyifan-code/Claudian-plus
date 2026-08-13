import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import { getDshDiscoveryState, updateDshDiscoveryState } from './discoveryState';
import {
  type DshDiscoveredModel,
  normalizeDshModelAliases,
  normalizeDshVisibleModels,
} from './models';

export interface PersistedDshProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  modelAliases: Record<string, string>;
  profile: string;
  providerRoute: string;
  reasoningEffort: DshReasoningEffort;
  visibleModels: string[];
}

export type DshReasoningEffort = 'high' | 'max' | 'off';

const DSH_REASONING_EFFORTS: readonly DshReasoningEffort[] = ['high', 'max', 'off'];

export function normalizeDshReasoningEffort(value: unknown): DshReasoningEffort {
  return typeof value === 'string' && (DSH_REASONING_EFFORTS as readonly string[]).includes(value)
    ? value as DshReasoningEffort
    : DEFAULT_DSH_PROVIDER_SETTINGS.reasoningEffort;
}

export interface DshProviderSettings extends PersistedDshProviderSettings {
  discoveredModels: DshDiscoveredModel[];
}

export const DEFAULT_DSH_PROVIDER_SETTINGS: Readonly<PersistedDshProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  profile: 'acp',
  providerRoute: 'deepseek-official',
  reasoningEffort: 'high',
  visibleModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
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

export function getDshProviderSettings(
  settings: Record<string, unknown>,
): DshProviderSettings {
  const config = getProviderConfig(settings, 'dsh');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;

  return {
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_DSH_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    discoveredModels: getDshDiscoveryState(settings).discoveredModels,
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_DSH_PROVIDER_SETTINGS.enabled,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_DSH_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'dsh')
      ?? DEFAULT_DSH_PROVIDER_SETTINGS.environmentVariables,
    modelAliases: normalizeDshModelAliases(config.modelAliases),
    profile: (config.profile as string | undefined)
      ?? DEFAULT_DSH_PROVIDER_SETTINGS.profile,
    providerRoute: (config.providerRoute as string | undefined)
      ?? DEFAULT_DSH_PROVIDER_SETTINGS.providerRoute,
    reasoningEffort: normalizeDshReasoningEffort(config.reasoningEffort),
    visibleModels: normalizeDshVisibleModels(
      config.visibleModels ?? DEFAULT_DSH_PROVIDER_SETTINGS.visibleModels,
    ),
  };
}

export function updateDshProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<DshProviderSettings>,
): DshProviderSettings {
  const current = getDshProviderSettings(settings);
  if ('discoveredModels' in updates) {
    updateDshDiscoveryState(settings, {
      ...(updates.discoveredModels !== undefined
        ? { discoveredModels: updates.discoveredModels }
        : {}),
    });
  }
  const nextVisibleModels = normalizeDshVisibleModels(
    updates.visibleModels ?? current.visibleModels,
  );
  const nextModelAliases = pruneModelAliasesToVisible(
    normalizeDshModelAliases(updates.modelAliases ?? current.modelAliases),
    nextVisibleModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  const hostnameKey = getHostnameKey();
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_DSH_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_DSH_PROVIDER_SETTINGS.cliPath;
  }

  const next: DshProviderSettings = {
    ...current,
    ...updates,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    modelAliases: nextModelAliases,
    visibleModels: nextVisibleModels,
  };

  if (updates.visibleModels !== undefined) {
    retargetRemovedDshSelections(settings, next);
  }

  setProviderConfig(settings, 'dsh', {
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    modelAliases: next.modelAliases,
    profile: next.profile,
    providerRoute: next.providerRoute,
    reasoningEffort: normalizeDshReasoningEffort(next.reasoningEffort),
    visibleModels: next.visibleModels,
  });

  return next;
}

function pruneModelAliasesToVisible(
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

function retargetRemovedDshSelections(
  settings: Record<string, unknown>,
  next: DshProviderSettings,
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

    if (value.startsWith('dsh:')) {
      const rawModelId = value.slice('dsh:'.length).trim();
      return rawModelId && visibleSet.has(rawModelId) ? null : `dsh:${fallbackRawId}`;
    }

    return null;
  };

  const savedProviderModel = settings.savedProviderModel;
  if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
    const savedEntry = (savedProviderModel as Record<string, unknown>).dsh;
    const nextSavedModel = maybeRetarget(savedEntry);
    if (nextSavedModel) {
      (savedProviderModel as Record<string, unknown>).dsh = nextSavedModel;
    }
  }

  const nextTopLevelModel = maybeRetarget(settings.model);
  if (nextTopLevelModel) {
    settings.model = nextTopLevelModel;
  }
}
