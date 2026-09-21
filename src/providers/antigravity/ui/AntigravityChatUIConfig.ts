import type {
  ProviderChatUIConfig,
  ProviderIconSvg,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { ANTIGRAVITY_PROVIDER_ICON } from '../../../shared/icons';
import {
  DEFAULT_ANTIGRAVITY_MODEL_ID,
  DEFAULT_ANTIGRAVITY_MODELS,
  encodeAntigravityModelSelectionId,
  isAntigravityModelSelectionId,
  looksLikeAntigravityModel,
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
 * Chat UI projection for Antigravity. Models are offered from manual model id
 * when set, plus the official verified Gemini models supported by agy.
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

    // Offer verified Gemini models
    for (const model of DEFAULT_ANTIGRAVITY_MODELS) {
      pushOption(options, seenValues, {
        description: model.description,
        label: model.label,
        value: encodeAntigravityModelSelectionId(model.rawId),
      });
    }

    // Pin selections existing conversations already use so a changed manual id
    // never strands them.
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
    return manualModelId
      ? encodeAntigravityModelSelectionId(manualModelId)
      : encodeAntigravityModelSelectionId(DEFAULT_ANTIGRAVITY_MODEL_ID);
  },

  ownsModel(model: string, settings?: Record<string, unknown>): boolean {
    if (!model || !model.trim()) {
      return false;
    }
    if (isAntigravityModelSelectionId(model)) {
      return true;
    }
    const runtimeModel = toAntigravityRuntimeModelId(model);
    if (looksLikeAntigravityModel(runtimeModel)) {
      return true;
    }
    if (settings) {
      const options = this.getModelOptions(settings);
      if (options.some(opt =>
        opt.value === model
        || toAntigravityRuntimeModelId(opt.value) === runtimeModel
        || opt.label.toLowerCase() === model.toLowerCase()
      )) {
        return true;
      }
    }
    return false;
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
    return isAntigravityModelSelectionId(model) || looksLikeAntigravityModel(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    if (isAntigravityModelSelectionId(model) || looksLikeAntigravityModel(model)) {
      settingsBag.model = encodeAntigravityModelSelectionId(toAntigravityRuntimeModelId(model));
    } else {
      settingsBag.model = '';
    }
  },

  normalizeModelVariant(model: string): string {
    if (isAntigravityModelSelectionId(model) || looksLikeAntigravityModel(model)) {
      return encodeAntigravityModelSelectionId(toAntigravityRuntimeModelId(model));
    }
    return model;
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getProviderIcon(): ProviderIconSvg {
    return ANTIGRAVITY_PROVIDER_ICON;
  },
};
