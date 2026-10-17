import { createStandardCliResolverClass } from '../../../core/providers/CachedCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderWorkspaceRegistration, ProviderWorkspaceServices } from '../../../core/providers/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import type { DshModel } from '../models';
import { DshHost } from '../runtime/DshHost';
import { createNativeDshConnection } from '../runtime/DshNativeConnection';
import { getDshProviderSettings, updateDshProviderSettings } from '../settings';
import { dshSettingsTabRenderer } from '../ui/DshSettingsTab';

export interface DshWorkspaceServices extends ProviderWorkspaceServices {
  dshHost: DshHost;
  refreshModelCatalog(): Promise<{ changed: boolean; persistedSettingsChanged?: boolean; diagnostics?: string }>;
  dispose(): Promise<void>;
}

const DshCliResolver = createStandardCliResolverClass({
  providerId: 'dsh', binaryName: 'dsh', getProviderSettings: getDshProviderSettings,
});

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function malformedCatalog(): never {
  throw new Error('Malformed DeepSeek Harness native model catalog.');
}

function configurationKey(settings: Record<string, unknown>): string {
  const current = getDshProviderSettings(settings);
  const environment = Object.entries(parseEnvironmentVariables(getRuntimeEnvironmentText(settings, 'dsh')))
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([current.cliPath, current.cliPathsByHost, environment]);
}

function flattenCatalog(value: unknown): DshModel[] {
  if (!record(value) || !Array.isArray(value.groups) || !Array.isArray(value.routableProviders)
    || !value.routableProviders.every(entry => typeof entry === 'string')) return malformedCatalog();
  const routable = new Set(value.routableProviders);
  const nativeDefault = record(value.default) ? value.default : undefined;
  const models: DshModel[] = [];
  for (const group of value.groups as unknown[]) {
    if (!record(group) || typeof group.id !== 'string' || !group.id.trim() || !Array.isArray(group.models)) return malformedCatalog();
    if (!routable.has(group.id)) continue;
    for (const entry of group.models as unknown[]) {
      if (!record(entry) || typeof entry.id !== 'string' || !entry.id.trim() || typeof entry.name !== 'string') return malformedCatalog();
      const model: DshModel = { provider: group.id, model: entry.id, label: entry.name };
      if (nativeDefault?.provider === group.id && nativeDefault.model === entry.id) model.isDefault = true;
      if (entry.reasoning !== undefined) {
        if (!record(entry.reasoning) || !Array.isArray(entry.reasoning.efforts)) return malformedCatalog();
        model.reasoning = [];
        for (const effort of entry.reasoning.efforts as unknown[]) {
          if (!record(effort) || typeof effort.id !== 'string' || !effort.id.trim()) return malformedCatalog();
          model.reasoning.push(effort.id);
        }
        if (typeof entry.reasoning.defaultEffort === 'string' && model.reasoning.includes(entry.reasoning.defaultEffort)) {
          model.defaultReasoning = entry.reasoning.defaultEffort;
        }
      }
      models.push(model);
    }
  }
  return models;
}

export function createDshWorkspaceServices(plugin: ProviderHost): DshWorkspaceServices {
  let activeConfiguration: string | undefined;
  const dshHost = new DshHost(async signal => {
    const openingConfiguration = configurationKey(plugin.settings);
    const connection = await createNativeDshConnection(plugin, signal);
    activeConfiguration = openingConfiguration;
    return { ...connection, async dispose() {
      try { await connection.dispose(); }
      finally { if (activeConfiguration === openingConfiguration) activeConfiguration = undefined; }
    } };
  }, 30000, () => {
    if (!getDshProviderSettings(plugin.settings).enabled) throw new Error('DeepSeek Harness is disabled.');
    if (activeConfiguration !== undefined && activeConfiguration !== configurationKey(plugin.settings)) {
      throw new Error('DeepSeek Harness configuration changed. Close its tabs and wait for the host to stop, or reload the plugin.');
    }
  });
  return {
    dshHost,
    cliResolver: new DshCliResolver(),
    settingsTabRenderer: dshSettingsTabRenderer,
    tabWarmupPolicy: { resolveMode: () => 'none' },
    async refreshModelCatalog() {
      if (!getDshProviderSettings(plugin.settings).enabled) return { changed: false };
      const openingConfiguration = configurationKey(plugin.settings);
      const lease = await dshHost.acquire();
      try {
        if (activeConfiguration !== undefined && activeConfiguration !== openingConfiguration) {
          throw new Error('DeepSeek Harness configuration changed while its native host was active. Restart the host before refreshing models.');
        }
        await lease.ready();
        const catalog = await lease.client.call('session/modelCatalog', {});
        const models = flattenCatalog(catalog);
        let changed = false;
        await plugin.mutateSettings(settings => {
          const current = getDshProviderSettings(settings);
          if (!current.enabled || configurationKey(settings) !== openingConfiguration
            || JSON.stringify(current.models) === JSON.stringify(models)) return;
          updateDshProviderSettings(settings, { models });
          changed = true;
        });
        return { changed, ...(changed ? { persistedSettingsChanged: true } : {}) };
      } finally {
        lease.release();
      }
    },
    dispose: () => dshHost.dispose(),
  };
}

export const dshWorkspaceRegistration: ProviderWorkspaceRegistration<DshWorkspaceServices> = {
  initialize: async ({ plugin }) => createDshWorkspaceServices(plugin),
};

export function getDshWorkspaceServices(): DshWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('dsh') as DshWorkspaceServices;
}
