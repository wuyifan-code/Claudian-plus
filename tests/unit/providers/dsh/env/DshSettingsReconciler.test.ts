import type { Conversation } from '@/core/types';
import { dshSettingsReconciler } from '@/providers/dsh/env/DshSettingsReconciler';
import { getDshProviderSettings } from '@/providers/dsh/settings';

describe('DeepSeek Harness environment reconciliation', () => {
  it('preserves native bindings and fingerprints only native storage routing', () => {
    const settings = { providerConfigs: { dsh: { environmentVariables: 'DEEPSEEK_API_KEY=secret-value\nDSH_HOME=/native/home' } } };
    const dsh = { id: 'dsh', title: 'DSH', createdAt: 1, updatedAt: 1, messages: [], providerId: 'dsh', sessionId: 'session', providerState: { sessionId: 'session' } } as Conversation;
    const other = { id: 'other', title: 'Other', createdAt: 1, updatedAt: 1, messages: [], providerId: 'codex', sessionId: 'other-session' } as Conversation;
    const result = dshSettingsReconciler.reconcileModelWithEnvironment(settings, [dsh, other]);
    expect(result).toEqual({ changed: true, invalidatedConversations: [] });
    expect(dsh.sessionId).toBe('session');
    expect(other.sessionId).toBe('other-session');
    expect(getDshProviderSettings(settings).environmentHash).not.toContain('secret-value');
    expect(dshSettingsReconciler.reconcileModelWithEnvironment(settings, [dsh, other]).changed).toBe(false);
    settings.providerConfigs.dsh.environmentVariables = 'DEEPSEEK_API_KEY=new-secret\nDSH_HOME=/native/home';
    expect(dshSettingsReconciler.reconcileModelWithEnvironment(settings, [dsh, other]).changed).toBe(false);
    expect(dshSettingsReconciler.invalidateConversationSessions([dsh])).toEqual([]);
  });

  it('clears stale catalog metadata without dropping the pinned model', () => {
    const settings = { providerConfigs: { dsh: {
      models: [{ provider: 'native', model: 'old', label: 'Old' }], selectedModel: 'dsh/native/old',
    } } };
    expect(dshSettingsReconciler.handleEnvironmentChange?.(settings)).toBe(true);
    expect(getDshProviderSettings(settings)).toMatchObject({ models: [], selectedModel: 'dsh/native/old' });
    expect(dshSettingsReconciler.handleEnvironmentChange?.(settings)).toBe(false);
  });

  it('does not alter model selections owned by another provider', () => {
    const settings = { model: 'codex/gpt', effortLevel: 'high' };
    expect(dshSettingsReconciler.normalizeModelVariantSettings(settings)).toBe(false);
    expect(settings).toEqual({ model: 'codex/gpt', effortLevel: 'high' });
  });
});
