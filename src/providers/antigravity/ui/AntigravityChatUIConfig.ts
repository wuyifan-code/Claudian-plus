import type {
  ProviderChatUIConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import {
  encodeAntigravityModelSelectionId,
  isAntigravityModelSelectionId,
  toAntigravityRuntimeModelId,
} from '../models';
import { getAntigravityProviderSettings } from '../settings';

const DEFAULT_CONTEXT_WINDOW = 200_000;

function pushOption(options: ProviderUIOption[], seenValues: Set<string>, option: ProviderUIOption): void {
  if (seenValues.has(option.value)) {
    return;
  }

  seenValues.add(option.value);
  options.push(option);
}

function getSavedAntigravityModelSelection(settings: Record<string, unknown>): string {
  return (settings.savedProviderModel
    && typeof settings.savedProviderModel === 'object'
    && !Array.isArray(settings.savedProviderModel)
    && typeof (settings.savedProviderModel as Record<string, unknown>).antigravity === 'string')
    ? (settings.savedProviderModel as Record<string, string>).antigravity
    : '';
}

/**
 * Chat UI projection for Antigravity. The provider exposes no discovery, no
 * reasoning control, and no permission surface (A0/A5a findings), so every
 * entry point it cannot honestly serve is omitted rather than rendered
 * disabled: models come from the manual model id only, and no permission-mode,
 * plan-mode, service-tier, or bang-bash control exists.
 */
export const antigravityChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const antigravitySettings = getAntigravityProviderSettings(settings);
    const seenValues = new Set<string>();
    const options: ProviderUIOption[] = [];

    if (antigravitySettings.manualModelId) {
      pushOption(options, seenValues, {
        description: 'Manual model id from provider settings',
        label: antigravitySettings.manualModelId,
        value: encodeAntigravityModelSelectionId(antigravitySettings.manualModelId),
      });
    }

    // Pin selections existing conversations already use so a changed manual id
    // never strands them. Deliberately no synthetic fallback: without a manual
    // model id there is no model to offer, and a fabricated entry would present
    // the CLI's account-side default as a selectable, verified option.
    const pinnedSelections = [
      typeof settings.model === 'string' ? settings.model : '',
      getSavedAntigravityModelSelection(settings),
    ];
    for (const selection of pinnedSelections) {
      if (!selection || !isAntigravityModelSelectionId(selection)) {
        continue;
      }

      pushOption(options, seenValues, {
        description: 'Selected in an existing session',
        label: toAntigravityRuntimeModelId(selection),
        value: selection,
      });
    }

    return options;
  },

  getDefaultModel(settings): string | null {
    const manualModelId = getAntigravityProviderSettings(settings).manualModelId;
    return manualModelId ? encodeAntigravityModelSelectionId(manualModelId) : null;
  },

  ownsModel(model: string): boolean {
    return isAntigravityModelSelectionId(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [];
  },

  getDefaultReasoningValue(): string {
    return '';
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isAntigravityModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    // Foreign ids are cleared, never adopted: the manual model id is the only
    // honest model source.
    settingsBag.model = isAntigravityModelSelectionId(model) ? model : '';
  },

  normalizeModelVariant(model: string): string {
    return isAntigravityModelSelectionId(model)
      ? encodeAntigravityModelSelectionId(toAntigravityRuntimeModelId(model))
      : model;
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getProviderIcon(): null {
    return null;
  },
};
