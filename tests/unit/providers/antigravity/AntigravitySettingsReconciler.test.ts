import { antigravitySettingsReconciler } from '@/providers/antigravity/env/AntigravitySettingsReconciler';
import {
  decodeAntigravityModelSelectionId,
  encodeAntigravityModelSelectionId,
} from '@/providers/antigravity/models';
import {
  DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
  getAntigravityProviderSettings,
} from '@/providers/antigravity/settings';

describe('antigravitySettingsReconciler.reconcileModelWithEnvironment', () => {
  it('is a no-op while no Antigravity environment key is verified to affect sessions', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: {
        antigravity: {
          ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
          enabled: true,
          manualModelId: 'gemini-3.8-flash-low',
        },
      },
    };
    const conversations = [
      {
        id: 'conv-antigravity',
        messages: [],
        providerId: 'antigravity',
        providerState: { conversationId: 'conv-uuid' },
        sessionId: 'conv-uuid',
      },
      {
        id: 'conv-claude',
        messages: [],
        providerId: 'claude',
        providerState: { providerSessionId: 'claude-session' },
        sessionId: 'claude-session',
      },
    ] as any;

    const result = antigravitySettingsReconciler.reconcileModelWithEnvironment(
      settings,
      conversations,
    );

    expect(result.changed).toBe(false);
    expect(result.invalidatedConversations).toHaveLength(0);
    expect(conversations[0].sessionId).toBe('conv-uuid');
    expect(getAntigravityProviderSettings(settings).environmentHash).toBe('');
  });

  it('rewrites a stale non-empty hash and invalidates only antigravity sessions', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: {
        antigravity: {
          ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
          environmentHash: 'STALE_KEY=1',
        },
      },
    };
    const conversations = [
      {
        id: 'conv-antigravity',
        messages: [],
        providerId: 'antigravity',
        providerState: { conversationId: 'conv-uuid' },
        sessionId: 'conv-uuid',
      },
      {
        id: 'conv-claude',
        messages: [],
        providerId: 'claude',
        providerState: { providerSessionId: 'claude-session' },
        sessionId: 'claude-session',
      },
    ] as any;

    const result = antigravitySettingsReconciler.reconcileModelWithEnvironment(
      settings,
      conversations,
    );

    expect(result.changed).toBe(true);
    expect(result.invalidatedConversations).toHaveLength(1);
    expect(result.invalidatedConversations[0].id).toBe('conv-antigravity');
    expect(conversations[0].sessionId).toBeNull();
    expect(conversations[0].providerState).toBeUndefined();
    // The claude conversation is untouched.
    expect(conversations[1].sessionId).toBe('claude-session');
    expect(getAntigravityProviderSettings(settings).environmentHash).toBe('');
  });

  it('skips conversations that have provider state but no session id yet', () => {
    // The shared reconciler skeleton invalidates on non-empty sessionId only.
    // Provider-state-aware detection (codex-style, via the typed providerState
    // helper) lands with the A3 runtime contract; until then this stays a
    // deliberate no-op for state-only conversations.
    const settings: Record<string, unknown> = {
      providerConfigs: {
        antigravity: {
          ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
          environmentHash: 'STALE_KEY=1',
        },
      },
    };
    const conversations = [
      {
        id: 'conv-antigravity-state-only',
        messages: [],
        providerId: 'antigravity',
        providerState: { conversationId: 'conv-uuid' },
        sessionId: null,
      },
    ] as any;

    const result = antigravitySettingsReconciler.reconcileModelWithEnvironment(
      settings,
      conversations,
    );

    expect(result.invalidatedConversations).toHaveLength(0);
    expect(conversations[0].providerState).toEqual({ conversationId: 'conv-uuid' });
  });
});

describe('antigravitySettingsReconciler.normalizeModelVariantSettings', () => {
  it('canonicalizes antigravity-namespaced selections in place', () => {
    const settings: Record<string, unknown> = {
      model: 'antigravity/ gemini-3.8-flash-low ',
      titleGenerationModel: 'antigravity/gemini-3.8-flash-low',
      providerConfigs: {
        antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS },
      },
      savedProviderModel: {
        antigravity: 'antigravity/gemini-3.8-flash-low',
      },
    };

    expect(antigravitySettingsReconciler.normalizeModelVariantSettings(settings)).toBe(true);
    expect(settings.model).toBe('antigravity/gemini-3.8-flash-low');
    expect(decodeAntigravityModelSelectionId(settings.model as string))
      .toBe('gemini-3.8-flash-low');
  });

  it('reports no change when selections are already canonical', () => {
    const settings: Record<string, unknown> = {
      model: encodeAntigravityModelSelectionId('gemini-3.1-pro-low'),
      providerConfigs: {
        antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS },
      },
    };

    expect(antigravitySettingsReconciler.normalizeModelVariantSettings(settings)).toBe(false);
  });

  it('leaves bare ids and other providers namespaced selections untouched', () => {
    const settings: Record<string, unknown> = {
      model: 'gemini-3.8-flash-low',
      titleGenerationModel: 'openai-codex/gpt-5',
      providerConfigs: {
        antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS },
      },
      savedProviderModel: {
        opencode: 'opencode/gemini-3.8-flash-low',
      },
    };

    expect(antigravitySettingsReconciler.normalizeModelVariantSettings(settings)).toBe(false);
    expect(settings.model).toBe('gemini-3.8-flash-low');
    expect(settings.titleGenerationModel).toBe('openai-codex/gpt-5');
    expect((settings.savedProviderModel as Record<string, unknown>).opencode)
      .toBe('opencode/gemini-3.8-flash-low');
  });

  it('keeps unrelated provider data intact while normalizing', () => {
    const settings: Record<string, unknown> = {
      model: 'antigravity/ gemini-3.8-flash-low ',
      providerConfigs: {
        codex: { enabled: true, cliPath: 'C:\\codex\\codex.exe' },
        antigravity: {
          ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
          manualModelId: 'gemini-3.8-flash-low',
          timeoutMs: 45_000,
        },
      },
    };

    antigravitySettingsReconciler.normalizeModelVariantSettings(settings);

    expect((settings.providerConfigs as Record<string, unknown>).codex).toEqual({
      enabled: true,
      cliPath: 'C:\\codex\\codex.exe',
    });
    const antigravity = getAntigravityProviderSettings(settings);
    expect(antigravity.manualModelId).toBe('gemini-3.8-flash-low');
    expect(antigravity.timeoutMs).toBe(45_000);
    expect(antigravity.enabled).toBe(false);
  });
});

describe('antigravitySettingsReconciler.handleEnvironmentChange', () => {
  it('changes nothing because antigravity owns no discovery state yet', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: {
        antigravity: {
          ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
          manualModelId: 'gemini-3.8-flash-low',
        },
      },
    };

    expect(antigravitySettingsReconciler.handleEnvironmentChange?.(settings)).toBe(false);
    expect(getAntigravityProviderSettings(settings).manualModelId).toBe('gemini-3.8-flash-low');
  });
});

describe('antigravitySettingsReconciler.invalidateConversationSessions', () => {
  it('clears session state only for antigravity conversations that have one', () => {
    const conversations = [
      {
        id: 'conv-antigravity',
        messages: [],
        providerId: 'antigravity',
        providerState: { conversationId: 'conv-uuid' },
        sessionId: 'conv-uuid',
      },
      {
        id: 'conv-antigravity-fresh',
        messages: [],
        providerId: 'antigravity',
        providerState: undefined,
        sessionId: null,
      },
      {
        id: 'conv-claude',
        messages: [],
        providerId: 'claude',
        providerState: { providerSessionId: 'claude-session' },
        sessionId: 'claude-session',
      },
    ] as any;

    const invalidated = antigravitySettingsReconciler.invalidateConversationSessions(
      conversations,
    );

    expect(invalidated.map(conversation => conversation.id)).toEqual(['conv-antigravity']);
    expect(conversations[0].sessionId).toBeNull();
    expect(conversations[1].sessionId).toBeNull();
    expect(conversations[2].sessionId).toBe('claude-session');
  });
});
