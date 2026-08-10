import {
  DEFAULT_KIMI_PROVIDER_SETTINGS,
  getKimiProviderSettings,
  updateKimiProviderSettings,
} from '@/providers/kimi/settings';

function createSettingsBag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      kimi: { ...DEFAULT_KIMI_PROVIDER_SETTINGS, ...overrides },
    },
  };
}

describe('getKimiProviderSettings', () => {
  it('applies defaults for missing fields', () => {
    const settings = getKimiProviderSettings({ providerConfigs: {} });
    expect(settings.enabled).toBe(false);
    expect(settings.cliPath).toBe('');
    expect(settings.environmentVariables).toBe('');
  });

  it('normalizes cliPathsByHost and migrates legacy hostname keys', () => {
    const settings = getKimiProviderSettings(createSettingsBag({
      cliPathsByHost: { 'unknown-host': 'C:\\kimi.exe' },
    }));
    expect(Object.keys(settings.cliPathsByHost)).toContain('unknown-host');
  });

  it('reads discovered models from the discovery state', () => {
    const bag = createSettingsBag({});
    updateKimiProviderSettings(bag, {
      discoveredModels: [{ label: 'k3', rawId: 'kimi-code/k3' }],
    });
    const settings = getKimiProviderSettings(bag);
    expect(settings.discoveredModels.map(model => model.rawId)).toEqual(['kimi-code/k3']);
  });
});

describe('updateKimiProviderSettings', () => {
  it('stores hostname-scoped cliPath', () => {
    const bag = createSettingsBag({});
    updateKimiProviderSettings(bag, { cliPath: 'C:\\kimi.exe' });
    const settings = getKimiProviderSettings(bag);
    expect(settings.cliPath).toBe('');
    expect(Object.values(settings.cliPathsByHost)).toContain('C:\\kimi.exe');
  });

  it('keeps thinking variants as distinct visible models', () => {
    const bag = createSettingsBag({});
    updateKimiProviderSettings(bag, {
      discoveredModels: [
        { label: 'k3', rawId: 'kimi-code/k3' },
        { label: 'k3 (thinking)', rawId: 'kimi-code/k3,thinking' },
      ],
    });
    updateKimiProviderSettings(bag, {
      visibleModels: ['kimi-code/k3,thinking'],
    });
    const settings = getKimiProviderSettings(bag);
    expect(settings.visibleModels).toEqual(['kimi-code/k3,thinking']);
  });

  it('prunes aliases that are no longer visible', () => {
    const bag = createSettingsBag({
      modelAliases: { 'kimi-code/k3': 'My K3' },
    });
    updateKimiProviderSettings(bag, { visibleModels: [] });
    const settings = getKimiProviderSettings(bag);
    expect(settings.modelAliases).toEqual({});
  });
});
