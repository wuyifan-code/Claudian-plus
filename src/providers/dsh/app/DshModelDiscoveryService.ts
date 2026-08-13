import * as fs from 'node:fs';
import * as path from 'node:path';

import { getProviderConfig } from '../../../core/providers/providerConfig';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type {
  ProviderModelCatalogRefreshResult,
} from '../../../core/providers/types';
import {
  updateDshDiscoveryState,
} from '../discoveryState';
import {
  type DshDiscoveredModel,
  encodeDshModelId,
  normalizeDshDiscoveredModels,
} from '../models';
import {
  type DshProfileModelCatalog,
  readDshProfileModelCatalog,
} from '../models/DshProfileModelsReader';
import { getDshProviderSettings, updateDshProviderSettings } from '../settings';

const PROFILE_PATCH_FILENAME = 'cordis.patch.yml';
const HOME_PATCH_FILENAME = 'cordis.patch.yml';

export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME?.trim();
  if (configured) {
    return configured;
  }
  const home = env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'] ?? '';
  return home ? path.join(home, '.dsh') : '';
}

export function getDshProfilePatchPaths(
  dshHome: string,
  profile: string,
): string[] {
  return [
    path.join(dshHome, 'profiles', profile, PROFILE_PATCH_FILENAME),
    path.join(dshHome, HOME_PATCH_FILENAME),
  ];
}

function readPatchIfPresent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Discovers the DSH profile's model catalog by reading its cordis patch
 * layers (`$DSH_HOME/profiles/<name>/cordis.patch.yml` + `$DSH_HOME/cordis.patch.yml`).
 * Pure file reads — no subprocess. The discovered catalog seeds the model
 * selector and per-model context windows; the acp-agent pins seed the
 * provider route and default model when unset.
 */
export class DshModelDiscoveryService {
  constructor(private readonly plugin: ProviderHost) {}

  refreshModelCatalog(): Promise<ProviderModelCatalogRefreshResult> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const dshSettings = getDshProviderSettings(settings);
    const dshHome = resolveDshHome();
    if (!dshHome) {
      return Promise.resolve({ changed: false });
    }

    let catalog: DshProfileModelCatalog = { models: [], acpAgent: null };
    for (const patchPath of getDshProfilePatchPaths(dshHome, dshSettings.profile)) {
      const content = readPatchIfPresent(patchPath);
      if (content === null) {
        continue;
      }
      const layer = readDshProfileModelCatalog(content);
      catalog = {
        models: mergeModels(catalog.models, layer.models),
        acpAgent: layer.acpAgent ?? catalog.acpAgent,
      };
    }

    const discoveredModels = normalizeDshDiscoveredModels(
      catalog.models.map((model) => ({
        ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
        ...(model.label ? { label: model.label } : {}),
        rawId: model.rawId,
      })),
    );

    let changed = updateDshDiscoveryState(settings, { discoveredModels });
    changed = this.seedSelections(settings, discoveredModels, catalog) || changed;

    return Promise.resolve({ changed });
  }

  private seedSelections(
    settings: Record<string, unknown>,
    discoveredModels: DshDiscoveredModel[],
    catalog: DshProfileModelCatalog,
  ): boolean {
    let changed = false;
    const current = getDshProviderSettings(settings);
    const persistedConfig = getProviderConfig(settings, 'dsh');

    // Seed visible models only when the stored config never set them — a
    // cleared list (explicit empty) is a deliberate user choice.
    const hasPersistedVisibleModels = Array.isArray(persistedConfig.visibleModels);
    if (!hasPersistedVisibleModels && discoveredModels.length > 0) {
      updateDshProviderSettings(settings, {
        visibleModels: discoveredModels.map((model) => model.rawId),
      });
      changed = true;
    }

    const acpModel = catalog.acpAgent?.model;
    const currentModel = typeof settings.model === 'string' ? settings.model.trim() : '';
    if (acpModel && (currentModel === '' || currentModel === 'dsh')) {
      settings.model = encodeDshModelId(acpModel);
      changed = true;
    }

    if (catalog.acpAgent?.provider && current.providerRoute === '') {
      updateDshProviderSettings(settings, { providerRoute: catalog.acpAgent.provider });
      changed = true;
    }

    return changed;
  }
}

function mergeModels(
  left: DshProfileModelCatalog['models'],
  right: DshProfileModelCatalog['models'],
): DshProfileModelCatalog['models'] {
  const merged = [...left];
  const seen = new Set(left.map((model) => model.rawId));
  for (const model of right) {
    if (!seen.has(model.rawId)) {
      seen.add(model.rawId);
      merged.push(model);
    }
  }
  return merged;
}
