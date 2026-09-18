import '@/providers';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { AntigravityInstructionRefineService } from '@/providers/antigravity/auxiliary/AntigravityInstructionRefineService';
import { AntigravityTitleGenerationService } from '@/providers/antigravity/auxiliary/AntigravityTitleGenerationService';
import { antigravityProviderCapabilities } from '@/providers/antigravity/capabilities';
import { AntigravityConversationHistoryService } from '@/providers/antigravity/history/AntigravityConversationHistoryService';
import { antigravityProviderRegistration } from '@/providers/antigravity/registration';
import { getAntigravityProviderSettings } from '@/providers/antigravity/settings';
import { piProviderRegistration } from '@/providers/pi/registration';

/** All the plugin surface the provider-owned services are allowed to consume. */
function createPlugin(): ProviderHost {
  return {
    app: { vault: { adapter: { basePath: '/tmp/antigravity-vault' } } },
    settings: { providerConfigs: { antigravity: { enabled: false } } },
  } as unknown as ProviderHost;
}

describe('Antigravity provider registration', () => {
  it('registers metadata, a disabled default, and the runtime factory', () => {
    expect(antigravityProviderRegistration.id).toBe('antigravity');
    expect(antigravityProviderRegistration.displayName).toBe('Antigravity');
    expect(antigravityProviderRegistration.blankTabOrder)
      .toBeGreaterThan(piProviderRegistration.blankTabOrder);
    expect(antigravityProviderRegistration.capabilities).toBe(antigravityProviderCapabilities);

    // The provider is enabled only when the user turned it on, and it never
    // becomes the default chat provider.
    expect(antigravityProviderRegistration.isEnabled({})).toBe(false);
    expect(antigravityProviderRegistration.isEnabled({ providerConfigs: { antigravity: { enabled: false } } })).toBe(false);
    expect(antigravityProviderRegistration.isEnabled({ providerConfigs: { antigravity: { enabled: true } } })).toBe(true);

    const settings: Record<string, unknown> = { providerConfigs: { antigravity: { enabled: false } } };
    antigravityProviderRegistration.setEnabled?.(settings, true);
    expect(getAntigravityProviderSettings(settings).enabled).toBe(true);

    expect(antigravityProviderRegistration.workspace.initialize).toEqual(expect.any(Function));
    expect(antigravityProviderRegistration.settingsStorage.normalizeStored).toEqual(expect.any(Function));
  });

  it('builds a runtime bound to the antigravity provider', () => {
    const runtime = antigravityProviderRegistration.createRuntime({ plugin: createPlugin() });
    expect(runtime.providerId).toBe('antigravity');
    runtime.cleanup();
  });

  it('normalizes stored settings without clobbering another provider config', () => {
    const target: Record<string, unknown> = { providerConfigs: { claude: { enabled: true } } };
    const stored: Record<string, unknown> = {
      providerConfigs: {
        antigravity: { enabled: true, manualModelId: 'gemini-3.8-flash-low', timeoutMs: 30_000 },
      },
    };

    const changed = antigravityProviderRegistration.settingsStorage.normalizeStored(target, stored);

    expect(changed).toBe(false);
    expect(getAntigravityProviderSettings(target)).toMatchObject({
      enabled: true,
      manualModelId: 'gemini-3.8-flash-low',
      timeoutMs: 30_000,
    });
    expect((target.providerConfigs as Record<string, unknown>).claude).toEqual({ enabled: true });
  });

  it('supplies the Antigravity history service', () => {
    expect(antigravityProviderRegistration.historyService)
      .toBeInstanceOf(AntigravityConversationHistoryService);
  });

  it('supplies auxiliary services that issue no model request', async () => {
    // A bare object: a service that reached for the CLI, a runner, or plugin
    // settings would fail here instead of silently passing.
    const plugin = {} as ProviderHost;

    const refine = antigravityProviderRegistration.createInstructionRefineService(plugin);
    expect(refine).toBeInstanceOf(AntigravityInstructionRefineService);
    await expect(refine.refineInstruction('write a haiku', '')).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('unavailable'),
    });

    // No auxiliary runner is registered: automatic titles are local, and the
    // shared auxiliary flow never asks this provider for a runner.
    expect(antigravityProviderRegistration.createAuxQueryRunner).toBeUndefined();
    // Omitting it is a real contract for callers: the registry reports the
    // generic unsupported error instead of the provider faking a runner.
    expect(() => ProviderRegistry.createAuxQueryRunner({} as ProviderHost, 'antigravity'))
      .toThrow('does not support auxiliary queries');
    expect(antigravityProviderRegistration.subagentLifecycleAdapter).toBeUndefined();
    expect(antigravityProviderRegistration.taskResultInterpreter).toBeDefined();
  });

  it('creates the model-free title service from the registration', async () => {
    const service = antigravityProviderRegistration.createTitleGenerationService({} as ProviderHost);
    expect(service).toBeInstanceOf(AntigravityTitleGenerationService);

    const callback = jest.fn(async () => {});
    await service.generateTitle('conversation-1', 'Fix the failing build', callback);
    expect(callback).toHaveBeenCalledWith('conversation-1', {
      success: true,
      title: 'Fix the failing build',
    });
  });

  it('routes antigravity model selections through the provider registry', () => {
    const enabled: Record<string, unknown> = {
      providerConfigs: { antigravity: { enabled: true, manualModelId: 'gemini-3.8-flash-low' } },
    };
    expect(ProviderRegistry.resolveProviderForModel('antigravity/gemini-3.8-flash-low', enabled))
      .toBe('antigravity');
    expect(ProviderRegistry.getEnabledProviderIds(enabled)).toContain('antigravity');

    const disabled: Record<string, unknown> = {
      providerConfigs: { antigravity: { enabled: false } },
    };
    expect(ProviderRegistry.getEnabledProviderIds(disabled)).not.toContain('antigravity');
  });
});
