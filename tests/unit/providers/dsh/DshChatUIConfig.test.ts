import { DEFAULT_DSH_PROVIDER_SETTINGS } from '@/providers/dsh/settings';
import { dshChatUIConfig } from '@/providers/dsh/ui/DshChatUIConfig';

function createSettingsBag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      dsh: { ...DEFAULT_DSH_PROVIDER_SETTINGS, ...overrides },
    },
  };
}

describe('dshChatUIConfig', () => {
  it('builds model options from visible models with the dsh: prefix', () => {
    const options = dshChatUIConfig.getModelOptions(createSettingsBag({
      visibleModels: ['deepseek-v4-flash'],
    }));
    expect(options.map((option) => option.value)).toEqual(['dsh:deepseek-v4-flash']);
  });

  it('applies aliases to model labels', () => {
    const options = dshChatUIConfig.getModelOptions(createSettingsBag({
      modelAliases: { 'deepseek-v4-flash': 'Flash' },
      visibleModels: ['deepseek-v4-flash'],
    }));
    expect(options[0]?.label).toBe('Flash');
  });

  it('owns only dsh-prefixed model ids', () => {
    expect(dshChatUIConfig.ownsModel('dsh:deepseek-v4-pro', {})).toBe(true);
    expect(dshChatUIConfig.ownsModel('dsh', {})).toBe(true);
    expect(dshChatUIConfig.ownsModel('claude', {})).toBe(false);
  });

  it('falls back to the static catalog when nothing is visible', () => {
    const options = dshChatUIConfig.getModelOptions(createSettingsBag({ visibleModels: [] }));
    expect(options.length).toBeGreaterThanOrEqual(2);
  });

  it('normalizes model variants through the prefix', () => {
    expect(dshChatUIConfig.normalizeModelVariant('dsh:deepseek-v4-pro', {}))
      .toBe('dsh:deepseek-v4-pro');
  });

  it('uses the DeepSeek context window default', () => {
    expect(dshChatUIConfig.getContextWindowSize('dsh:deepseek-v4-flash')).toBe(128_000);
  });

  it('prefers the discovered profile context window over the default', () => {
    const settings = createSettingsBag({});
    settings.dshDiscoveryState = {
      discoveredModels: [{ rawId: 'deepseek-v4-flash', contextWindow: 1000000 }],
    };
    expect(dshChatUIConfig.getContextWindowSize('dsh:deepseek-v4-flash', undefined, settings))
      .toBe(1_000_000);
  });

  it('lets custom limits override discovered context windows', () => {
    const settings = createSettingsBag({});
    settings.dshDiscoveryState = {
      discoveredModels: [{ rawId: 'deepseek-v4-flash', contextWindow: 1000000 }],
    };
    expect(dshChatUIConfig.getContextWindowSize(
      'dsh:deepseek-v4-flash',
      { 'dsh:deepseek-v4-flash': 500 },
      settings,
    )).toBe(500);
  });

  it('adds discovered profile models to the options', () => {
    const settings = createSettingsBag({ visibleModels: [] });
    settings.dshDiscoveryState = {
      discoveredModels: [{ rawId: 'deepseek-v4-flash', label: 'Flash', contextWindow: 1000000 }],
    };
    const options = dshChatUIConfig.getModelOptions(settings);
    expect(options.map((option) => option.value)).toContain('dsh:deepseek-v4-flash');
    expect(options.find((option) => option.value === 'dsh:deepseek-v4-flash')?.description)
      .toContain('1,000,000');
  });

  it('is an adaptive reasoning provider with off/high/max effort levels', () => {
    expect(dshChatUIConfig.isAdaptiveReasoningModel('dsh:deepseek-v4-flash', {})).toBe(true);
    const options = dshChatUIConfig.getReasoningOptions('dsh:deepseek-v4-flash', {});
    expect(options.map((option) => option.value)).toEqual(['off', 'high', 'max']);
  });

  it('persists reasoning selection into dsh settings and effortLevel', () => {
    const settings = createSettingsBag({});
    dshChatUIConfig.applyReasoningSelection?.('dsh:deepseek-v4-flash', 'max', settings);
    const dshConfig = (settings.providerConfigs as Record<string, Record<string, unknown>>).dsh;
    expect(dshConfig.reasoningEffort).toBe('max');
    expect(settings.effortLevel).toBe('max');
    expect(dshChatUIConfig.getDefaultReasoningValue('dsh:deepseek-v4-flash', settings)).toBe('max');
  });

  it('defaults reasoning to high when unset', () => {
    expect(dshChatUIConfig.getDefaultReasoningValue('dsh:deepseek-v4-flash', createSettingsBag({})))
      .toBe('high');
    expect(dshChatUIConfig.getDefaultReasoningValue('dsh:deepseek-v4-flash', {})).toBe('high');
  });
});
