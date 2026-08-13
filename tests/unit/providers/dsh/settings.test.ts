import {
  DEFAULT_DSH_PROVIDER_SETTINGS,
  getDshProviderSettings,
  updateDshProviderSettings,
} from '@/providers/dsh/settings';

function createSettingsBag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      dsh: { ...DEFAULT_DSH_PROVIDER_SETTINGS, ...overrides },
    },
  };
}

describe('getDshProviderSettings', () => {
  it('applies defaults for missing fields', () => {
    const settings = getDshProviderSettings({ providerConfigs: {} });
    expect(settings.enabled).toBe(false);
    expect(settings.cliPath).toBe('');
    expect(settings.profile).toBe('acp');
    expect(settings.providerRoute).toBe('deepseek-official');
    expect(settings.reasoningEffort).toBe('high');
    expect(settings.visibleModels).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  it('normalizes cliPathsByHost and keeps unknown host entries', () => {
    const settings = getDshProviderSettings(createSettingsBag({
      cliPathsByHost: { 'other-host': 'C:\\dsh.cmd' },
    }));
    expect(settings.cliPathsByHost).toEqual({ 'other-host': 'C:\\dsh.cmd' });
  });
});

describe('updateDshProviderSettings', () => {
  it('stores hostname-scoped cliPath', () => {
    const bag = createSettingsBag({});
    updateDshProviderSettings(bag, { cliPath: 'C:\\dsh.cmd' });
    const settings = getDshProviderSettings(bag);
    expect(settings.cliPath).toBe('');
    expect(Object.values(settings.cliPathsByHost)).toContain('C:\\dsh.cmd');
  });

  it('persists profile and provider route', () => {
    const bag = createSettingsBag({});
    updateDshProviderSettings(bag, { profile: 'my-acp', providerRoute: 'pi-ai' });
    const settings = getDshProviderSettings(bag);
    expect(settings.profile).toBe('my-acp');
    expect(settings.providerRoute).toBe('pi-ai');
  });

  it('persists and normalizes reasoning effort', () => {
    const bag = createSettingsBag({});
    updateDshProviderSettings(bag, { reasoningEffort: 'max' as never });
    expect(getDshProviderSettings(bag).reasoningEffort).toBe('max');

    updateDshProviderSettings(bag, { reasoningEffort: 'bogus' as never });
    expect(getDshProviderSettings(bag).reasoningEffort).toBe('high');
  });

  it('normalizes visible models and prunes aliases that are no longer visible', () => {
    const bag = createSettingsBag({
      modelAliases: { 'deepseek-v4-pro': 'Pro' },
    });
    updateDshProviderSettings(bag, { visibleModels: ['deepseek-v4-flash'] });
    const settings = getDshProviderSettings(bag);
    expect(settings.visibleModels).toEqual(['deepseek-v4-flash']);
    expect(settings.modelAliases).toEqual({});
  });

  it('keeps aliases for models that stay visible', () => {
    const bag = createSettingsBag({});
    updateDshProviderSettings(bag, {
      modelAliases: { 'deepseek-v4-pro': 'Pro' },
      visibleModels: ['deepseek-v4-pro'],
    });
    const settings = getDshProviderSettings(bag);
    expect(settings.modelAliases).toEqual({ 'deepseek-v4-pro': 'Pro' });
  });
});
