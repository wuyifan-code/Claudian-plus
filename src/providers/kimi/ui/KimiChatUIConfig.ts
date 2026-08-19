import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { KIMI_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeKimiModelId,
  encodeKimiModelId,
  isKimiModelSelectionId,
  KIMI_SYNTHETIC_MODEL_ID,
  resolveKimiBaseModelRawId,
} from '../models';
import { KimiChatRuntime } from '../runtime/KimiChatRuntime';
import { getKimiProviderSettings } from '../settings';

const KIMI_MODELS: ProviderUIOption[] = [
  { value: KIMI_SYNTHETIC_MODEL_ID, label: 'Kimi', description: 'Kimi Code CLI' },
];
const DEFAULT_CONTEXT_WINDOW = 200_000;
const KIMI_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
};

export const kimiChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const kimiSettings = getKimiProviderSettings(settings);
    const applyAlias = (rawId: string, option: ProviderUIOption): ProviderUIOption => {
      const alias = kimiSettings.modelAliases[rawId];
      return alias ? { ...option, label: alias } : option;
    };
    const discoveredByRawId = new Map(
      kimiSettings.discoveredModels.map((model) => [
        model.rawId,
        applyAlias(model.rawId, {
          description: model.description ?? 'Kimi Code CLI model',
          label: model.label,
          value: encodeKimiModelId(model.rawId),
        }),
      ]),
    );
    const savedProviderModel = (
      settings.savedProviderModel
      && typeof settings.savedProviderModel === 'object'
      && !Array.isArray(settings.savedProviderModel)
    )
      ? settings.savedProviderModel as Record<string, unknown>
      : null;

    const seenValues = new Set<string>();
    const options: ProviderUIOption[] = [];
    for (const rawModelId of [...kimiSettings.visibleModels].reverse()) {
      const encodedModelId = encodeKimiModelId(rawModelId);
      pushOption(
        options,
        seenValues,
        encodedModelId,
        discoveredByRawId.get(encodedModelId)
          ?? applyAlias(rawModelId, {
            description: 'Configured model',
            label: rawModelId,
            value: encodedModelId,
          }),
      );
    }

    for (const model of kimiSettings.discoveredModels) {
      const encodedModelId = encodeKimiModelId(model.rawId);
      pushOption(
        options,
        seenValues,
        encodedModelId,
        discoveredByRawId.get(encodedModelId)
          ?? applyAlias(model.rawId, {
            description: model.description ?? 'Kimi Code CLI model',
            label: model.label,
            value: encodedModelId,
          }),
      );
    }

    const selectedModelValues = [
      typeof settings.model === 'string' ? settings.model : '',
      typeof savedProviderModel?.kimi === 'string'
        ? savedProviderModel.kimi
        : '',
    ];

    for (const model of selectedModelValues) {
      const rawModelId = decodeKimiModelId(model);
      if (
        !model
        || !isKimiModelSelectionId(model)
        || model === KIMI_SYNTHETIC_MODEL_ID
        || !rawModelId
      ) {
        continue;
      }

      const baseRawId = resolveKimiBaseModelRawId(rawModelId, kimiSettings.discoveredModels);
      const baseModelId = encodeKimiModelId(baseRawId);
      pushOption(
        options,
        seenValues,
        baseModelId,
        discoveredByRawId.get(baseModelId)
          ?? applyAlias(baseRawId, {
            description: 'Selected in an existing session',
            label: baseRawId,
            value: baseModelId,
          }),
      );
    }

    return options.length > 0 ? options : [...KIMI_MODELS];
  },

  ownsModel(model: string): boolean {
    return isKimiModelSelectionId(model);
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
    return isKimiModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeKimiModelId(model);
    if (!rawModelId) {
      settingsBag.model = KIMI_SYNTHETIC_MODEL_ID;
      return;
    }

    const kimiSettings = getKimiProviderSettings(settingsBag);
    const baseRawId = resolveKimiBaseModelRawId(rawModelId, kimiSettings.discoveredModels);
    settingsBag.model = encodeKimiModelId(baseRawId);
  },

  async prepareModelMetadata(model: string, _settings: Record<string, unknown>, context): Promise<void> {
    const rawModelId = decodeKimiModelId(model);
    if (!rawModelId) {
      return;
    }

    const kimiSettings = getKimiProviderSettings(context.plugin.settings);
    const baseRawId = resolveKimiBaseModelRawId(rawModelId, kimiSettings.discoveredModels);
    if (baseRawId && kimiSettings.discoveredModels.some((entry) => entry.rawId === baseRawId)) {
      return;
    }

    const runtime = new KimiChatRuntime(context.plugin);
    try {
      runtime.syncConversationState({ sessionId: null });
      await runtime.warmModelMetadata(model);
    } catch {
      // Metadata warmup is opportunistic; the first real turn can still discover it.
    } finally {
      runtime.cleanup();
    }
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeKimiModelId(model);
    if (!rawModelId) {
      return model;
    }

    const kimiSettings = getKimiProviderSettings(settings);
    const baseRawId = resolveKimiBaseModelRawId(rawModelId, kimiSettings.discoveredModels);
    return encodeKimiModelId(baseRawId);
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return KIMI_PERMISSION_MODE_TOGGLE;
  },

  getProviderIcon() {
    return KIMI_PROVIDER_ICON;
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
