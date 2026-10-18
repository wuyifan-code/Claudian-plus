import type { ProviderChatUIConfig, ProviderPermissionModeToggleConfig, ProviderUIOption } from '../../../core/providers/types';
import { localeText } from '../../../i18n/i18n';
import { decodeDshModelId, DSH_DEFAULT_MODEL_ID, encodeDshModelId, isDshModelId } from '../models';
import { getDshProviderSettings, updateDshProviderSettings } from '../settings';

const DSH_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: localeText('安全', 'Safe'),
  activeValue: 'yolo',
  activeLabel: 'YOLO',
};

function getModel(model: string, settings: Record<string, unknown>) {
  return getDshProviderSettings(settings).models.find(entry => encodeDshModelId(entry.provider, entry.model) === model);
}

function applyDefaults(model: string, settings: unknown): void {
  if (!isDshModelId(model) || !settings || typeof settings !== 'object' || Array.isArray(settings)) return;
  const bag = settings as Record<string, unknown>;
  const metadata = getModel(model, bag);
  const levels = metadata?.reasoning ?? [];
  bag.model = model;
  bag.effortLevel = typeof bag.effortLevel === 'string' && levels.includes(bag.effortLevel)
    ? bag.effortLevel : metadata?.defaultReasoning ?? levels[0] ?? '';
  updateDshProviderSettings(bag, { selectedModel: model });
}

export const dshChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings) {
    const config = getDshProviderSettings(settings);
    const options: ProviderUIOption[] = config.models.map(model => ({
      value: encodeDshModelId(model.provider, model.model), label: model.label, group: model.provider,
    }));
    const nativeDefault = config.models.find(model => model.isDefault);
    const defaultLabel = nativeDefault
      ? `${nativeDefault.label} (${localeText('Harness 默认', 'Harness default')})`
      : 'DeepSeek Harness native default';
    const pinned = [config.selectedModel ?? DSH_DEFAULT_MODEL_ID, settings.model,
      (settings.savedProviderModel as Record<string, unknown> | undefined)?.dsh];
    for (const selection of pinned) {
      if (typeof selection !== 'string' || !isDshModelId(selection) || options.some(option => option.value === selection)) continue;
      const decoded = decodeDshModelId(selection);
      options.push({ value: selection, label: decoded ? `${decoded.provider}/${decoded.model}` : defaultLabel });
    }
    return options.length ? options : [{ value: DSH_DEFAULT_MODEL_ID, label: defaultLabel }];
  },
  getDefaultModel(settings) { return getDshProviderSettings(settings).selectedModel ?? DSH_DEFAULT_MODEL_ID; },
  ownsModel: isDshModelId,
  isAdaptiveReasoningModel(model, settings) { return !!getModel(model, settings)?.reasoning?.length; },
  getReasoningOptions(model, settings) {
    return (getModel(model, settings)?.reasoning ?? []).map(value => ({ value, label: value }));
  },
  getDefaultReasoningValue(model, settings) {
    const metadata = getModel(model, settings);
    return metadata?.defaultReasoning ?? metadata?.reasoning?.[0] ?? '';
  },
  getContextWindowSize(model, customLimits, settings) {
    const custom = customLimits?.[model];
    if (typeof custom === 'number' && Number.isFinite(custom) && custom > 0) return custom;
    return settings ? getModel(model, settings)?.contextWindow ?? 0 : 0;
  },
  isDefaultModel(model) { return model === DSH_DEFAULT_MODEL_ID; },
  applyModelDefaults: applyDefaults,
  normalizeModelVariant(model) { return model; },
  getCustomModelIds() { return new Set<string>(); },
  getPermissionModeToggle() { return DSH_PERMISSION_MODE_TOGGLE; },
  getModeSelector() { return null; },
};
