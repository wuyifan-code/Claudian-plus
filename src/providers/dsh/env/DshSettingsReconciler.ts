import { createProviderSettingsReconciler } from '../../../core/providers/settingsReconciler';
import { clearDshDiscoveryState } from '../discoveryState';
import {
  decodeDshModelId,
  isDshModelSelectionId,
  normalizeDshVisibleModels,
} from '../models';
import {
  getDshProviderSettings,
  updateDshProviderSettings,
} from '../settings';

const DSH_ENV_HASH_KEYS = [
  'DSH_HOME',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
] as const;

export const dshSettingsReconciler = createProviderSettingsReconciler({
  providerId: 'dsh',
  envHashKeys: DSH_ENV_HASH_KEYS,
  clearDiscoveryState: clearDshDiscoveryState,
  getSettings: getDshProviderSettings,
  updateSettings: updateDshProviderSettings,
  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    let changed = false;

    const normalizeSelection = (value: unknown): string | null => {
      if (typeof value !== 'string' || !isDshModelSelectionId(value)) {
        return null;
      }
      return decodeDshModelId(value) ? value : null;
    };

    const modelSelection = normalizeSelection(settings.model);
    if (typeof settings.model === 'string' && modelSelection && settings.model !== modelSelection) {
      settings.model = modelSelection;
      changed = true;
    }

    const titleModelSelection = normalizeSelection(settings.titleGenerationModel);
    if (
      typeof settings.titleGenerationModel === 'string'
      && titleModelSelection
      && settings.titleGenerationModel !== titleModelSelection
    ) {
      settings.titleGenerationModel = titleModelSelection;
      changed = true;
    }

    const dshSettings = getDshProviderSettings(settings);
    const normalizedVisibleModels = normalizeDshVisibleModels(dshSettings.visibleModels);
    if (JSON.stringify(normalizedVisibleModels) !== JSON.stringify(dshSettings.visibleModels)) {
      updateDshProviderSettings(settings, { visibleModels: normalizedVisibleModels });
      changed = true;
    }

    return changed;
  },
});
