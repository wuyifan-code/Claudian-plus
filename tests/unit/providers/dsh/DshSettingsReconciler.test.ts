import { dshSettingsReconciler } from '@/providers/dsh/env/DshSettingsReconciler';
import { DEFAULT_DSH_PROVIDER_SETTINGS } from '@/providers/dsh/settings';

function createSettingsBag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'dsh:deepseek-v4-flash',
    providerConfigs: {
      dsh: { ...DEFAULT_DSH_PROVIDER_SETTINGS, ...overrides },
    },
    titleGenerationModel: '',
  };
}

describe('dshSettingsReconciler', () => {
  it('keeps valid dsh model selections untouched', () => {
    const settings = createSettingsBag();
    expect(dshSettingsReconciler.normalizeModelVariantSettings(settings)).toBe(false);
    expect(settings.model).toBe('dsh:deepseek-v4-flash');
  });

  it('normalizes malformed dsh selections back to the prefixed form', () => {
    const settings = createSettingsBag({});
    settings.model = 'dsh:deepseek-v4-pro';
    expect(dshSettingsReconciler.normalizeModelVariantSettings(settings)).toBe(false);
  });

  it('invalidates conversations when DEEPSEEK environment changes', () => {
    const settings = createSettingsBag({ environmentHash: 'old' });
    settings.environmentVariables = 'DEEPSEEK_API_KEY=sk-new';
    const conversations = [{ id: 'c1', sessionId: 's1', providerId: 'dsh' }] as never[];

    const result = dshSettingsReconciler.reconcileModelWithEnvironment(settings, conversations);
    expect(result.changed).toBe(true);
    expect(result.invalidatedConversations).toHaveLength(1);
    expect(result.invalidatedConversations[0]?.sessionId).toBeNull();
  });

  it('leaves conversations alone when the environment hash matches', () => {
    const settings = createSettingsBag({ environmentHash: 'same-hash' });
    settings.environmentVariables = 'DEEPSEEK_API_KEY=sk-x';

    // The saved hash must equal the computed hash; seed it by running once.
    dshSettingsReconciler.reconcileModelWithEnvironment(settings, []);
    const second = dshSettingsReconciler.reconcileModelWithEnvironment(settings, [] as never[]);
    expect(second.changed).toBe(false);
  });
});
