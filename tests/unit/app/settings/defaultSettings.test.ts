import { DEFAULT_CLAUDIAN_PLUS_SETTINGS } from '@/app/settings/defaultSettings';
import { resolveAuxiliarySavingMode } from '@/core/auxiliary/AuxiliaryRequestPolicy';

describe('enhanced default settings', () => {
  it('starts new installs with Codex and GPT-5.6 selected', () => {
    expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.settingsProvider).toBe('codex');
    expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.model).toBe('gpt-5.6-sol');
    expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.savedProviderModel).toMatchObject({
      codex: 'gpt-5.6-sol',
    });
    expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.providerConfigs.codex).toMatchObject({
      enabled: true,
    });
  });

  it('does not grant fresh installs approval-free full-machine access', () => {
    expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.permissionMode).toBe('normal');
  });

  it('keeps the saving mode on standard with an unlimited daily budget by default', () => {
    expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.auxiliarySavingMode).toBe('standard');
    expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.backgroundRequestDailyLimit).toBeNull();
  });

  it('resolves missing saved saving modes to standard without disabling user features', () => {
    expect(resolveAuxiliarySavingMode(undefined)).toBe('standard');
    expect(resolveAuxiliarySavingMode('economy')).toBe('economy');
  });
});
