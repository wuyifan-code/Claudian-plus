import { getDshProviderSettings, updateDshProviderSettings } from '@/providers/dsh/settings';

describe('DeepSeek Harness settings', () => {
  it('is opt-in with a bounded startup default and no invented models', () => {
    expect(getDshProviderSettings({})).toEqual({
      enabled: false, cliPath: '', cliPathsByHost: {}, environmentVariables: '',
      environmentHash: '', startupTimeoutMs: 90000, models: [],
    });
  });

  it('preserves unrecognized provider fields and other providers during updates', () => {
    const settings = { providerConfigs: { dsh: { future: { key: 1 } }, codex: { enabled: true } } };
    updateDshProviderSettings(settings, { enabled: true });
    expect(settings.providerConfigs.dsh).toMatchObject({ future: { key: 1 }, enabled: true });
    expect(settings.providerConfigs.codex).toEqual({ enabled: true });
  });

  it('rejects corrupt persisted values without mutating the source', () => {
    const settings = { providerConfigs: { dsh: {
      enabled: 'yes', cliPath: 4, models: [null, { provider: 'native', model: 'model', label: 'Model', contextWindow: -1, reasoning: ['low', 'low', 5] }],
      startupTimeoutMs: -1, selectedModel: 'codex/gpt',
    } } };
    const result = getDshProviderSettings(settings);
    expect(result.enabled).toBe(false);
    expect(result.cliPath).toBe('');
    expect(result.startupTimeoutMs).toBe(90000);
    expect(result.selectedModel).toBeUndefined();
    expect(result.models).toEqual([{ provider: 'native', model: 'model', label: 'Model', reasoning: ['low'] }]);
    expect(settings.providerConfigs.dsh.enabled).toBe('yes');
  });
});
