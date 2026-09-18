import { createProviderSettingsReconciler } from '../../../core/providers/settingsReconciler';
import {
  decodeAntigravityModelSelectionId,
  encodeAntigravityModelSelectionId,
  isAntigravityModelSelectionId,
} from '../models';
import {
  getAntigravityProviderSettings,
  updateAntigravityProviderSettings,
} from '../settings';

/**
 * No Antigravity environment variable is verified to redirect agy state,
 * credentials, or session data (A0 2026-09-18, `.context/antigravity/compatibility.md`).
 * The hash therefore stays constant and environment reconciliation never
 * invalidates sessions on its own; extend this list only with keys proven to
 * relocate provider state, and never with credential/token variables.
 */
const ANTIGRAVITY_ENV_HASH_KEYS: readonly string[] = [];

function canonicalizeSelection(value: unknown): string | null {
  if (typeof value !== 'string' || !isAntigravityModelSelectionId(value)) {
    return null;
  }

  const modelId = decodeAntigravityModelSelectionId(value);
  return modelId ? encodeAntigravityModelSelectionId(modelId) : null;
}

export const antigravitySettingsReconciler = createProviderSettingsReconciler({
  providerId: 'antigravity',
  envHashKeys: ANTIGRAVITY_ENV_HASH_KEYS,
  // Model discovery is not structurally available (the `agy models` TUI table
  // is not a stable API), so there is no provider-owned discovery state to
  // clear; the manual model id is the answer and must survive env changes.
  clearDiscoveryState: () => false,
  getSettings: getAntigravityProviderSettings,
  updateSettings: updateAntigravityProviderSettings,
  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    let changed = false;

    const canonicalModel = canonicalizeSelection(settings.model);
    if (typeof settings.model === 'string' && canonicalModel && settings.model !== canonicalModel) {
      settings.model = canonicalModel;
      changed = true;
    }

    const canonicalTitleModel = canonicalizeSelection(settings.titleGenerationModel);
    if (
      typeof settings.titleGenerationModel === 'string'
      && canonicalTitleModel
      && settings.titleGenerationModel !== canonicalTitleModel
    ) {
      settings.titleGenerationModel = canonicalTitleModel;
      changed = true;
    }

    const savedProviderModelRaw = settings.savedProviderModel;
    if (
      savedProviderModelRaw
      && typeof savedProviderModelRaw === 'object'
      && !Array.isArray(savedProviderModelRaw)
    ) {
      const savedProviderModel = savedProviderModelRaw as Record<string, unknown>;
      const canonicalSavedModel = canonicalizeSelection(savedProviderModel.antigravity);
      if (
        typeof savedProviderModel.antigravity === 'string'
        && canonicalSavedModel
        && savedProviderModel.antigravity !== canonicalSavedModel
      ) {
        savedProviderModel.antigravity = canonicalSavedModel;
        changed = true;
      }
    }

    return changed;
  },
});
