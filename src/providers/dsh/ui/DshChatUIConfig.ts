import type {
  ProviderChatUIConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { DSH_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeDshModelId,
  encodeDshModelId,
  isDshModelSelectionId,
} from '../models';
import {
  type DshReasoningEffort,
  getDshProviderSettings,
  updateDshProviderSettings,
} from '../settings';

const DSH_MODELS: ProviderUIOption[] = [
  { value: 'dsh:deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'DeepSeek Harness' },
  { value: 'dsh:deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'DeepSeek Harness' },
];
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * DSH's deepseek-official adapter accepts `reasoningEffort: off|high|max`
 * (plus `thinking: enabled|disabled`) at the llm row config, pinned per
 * process through the launch overlay. The chat toolbar therefore exposes
 * effort levels; switching effort restarts the runtime like a model switch.
 */
const DSH_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

export const dshChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const dshSettings = getDshProviderSettings(settings);
    const applyAlias = (rawId: string, option: ProviderUIOption): ProviderUIOption => {
      const alias = dshSettings.modelAliases[rawId];
      return alias ? { ...option, label: alias } : option;
    };
    const discoveredByRawId = new Map(
      dshSettings.discoveredModels.map((model) => [
        encodeDshModelId(model.rawId),
        applyAlias(model.rawId, {
          description: model.contextWindow !== undefined
            ? `${model.contextWindow.toLocaleString()} tokens context`
            : 'Discovered from the DSH profile',
          label: model.label ?? model.rawId,
          value: encodeDshModelId(model.rawId),
        }),
      ]),
    );

    const seenValues = new Set<string>();
    const options: ProviderUIOption[] = [];
    for (const rawModelId of [...dshSettings.visibleModels].reverse()) {
      const encodedModelId = encodeDshModelId(rawModelId);
      pushOption(
        options,
        seenValues,
        encodedModelId,
        discoveredByRawId.get(encodedModelId)
          ?? applyAlias(rawModelId, {
            description: 'Configured DeepSeek model',
            label: rawModelId,
            value: encodedModelId,
          }),
      );
    }

    for (const model of dshSettings.discoveredModels) {
      const encodedModelId = encodeDshModelId(model.rawId);
      pushOption(
        options,
        seenValues,
        encodedModelId,
        discoveredByRawId.get(encodedModelId)
          ?? applyAlias(model.rawId, {
            description: 'Discovered from the DSH profile',
            label: model.label ?? model.rawId,
            value: encodedModelId,
          }),
      );
    }

    const selectedModel = typeof settings.model === 'string' ? settings.model : '';
    const rawModelId = decodeDshModelId(selectedModel);
    if (selectedModel && rawModelId) {
      const encodedModelId = encodeDshModelId(rawModelId);
      pushOption(
        options,
        seenValues,
        encodedModelId,
        applyAlias(rawModelId, {
          description: 'Selected in an existing session',
          label: rawModelId,
          value: encodedModelId,
        }),
      );
    }

    return options.length > 0 ? options : [...DSH_MODELS];
  },

  ownsModel(model: string): boolean {
    return isDshModelSelectionId(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return true;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return DSH_REASONING_OPTIONS;
  },

  getDefaultReasoningValue(_model: string, settings?: Record<string, unknown>): string {
    if (settings) {
      return getDshProviderSettings(settings).reasoningEffort;
    }
    return 'high';
  },

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const settingsBag = settings as Record<string, unknown>;
    const effort = DSH_REASONING_OPTIONS.some((option) => option.value === value)
      ? value as DshReasoningEffort
      : 'high' as DshReasoningEffort;
    updateDshProviderSettings(settingsBag, { reasoningEffort: effort });
    settingsBag.effortLevel = effort;
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>, settings?: Record<string, unknown>): number {
    const customLimit = customLimits?.[model];
    if (customLimit !== undefined) {
      return customLimit;
    }

    const rawModelId = decodeDshModelId(model);
    if (rawModelId && settings) {
      const dshSettings = getDshProviderSettings(settings);
      const discovered = dshSettings.discoveredModels.find((entry) => entry.rawId === rawModelId);
      if (discovered?.contextWindow !== undefined) {
        return discovered.contextWindow;
      }
    }

    return DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isDshModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeDshModelId(model);
    if (!rawModelId) {
      settingsBag.model = 'dsh';
      return;
    }

    settingsBag.model = encodeDshModelId(rawModelId);
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeDshModelId(model);
    if (!rawModelId) {
      return model;
    }

    return encodeDshModelId(rawModelId);
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getPermissionModeToggle(): null {
    // DSH ACP requests permissions per tool call through the standard
    // request_permission flow; the sandbox policy lives in the profile.
    return null;
  },

  getProviderIcon() {
    return DSH_PROVIDER_ICON;
  },
};

function pushOption(
  target: ProviderUIOption[],
  seenValues: Set<string>,
  value: string,
  option: ProviderUIOption,
): void {
  if (seenValues.has(value)) {
    return;
  }

  seenValues.add(value);
  target.push(option);
}
