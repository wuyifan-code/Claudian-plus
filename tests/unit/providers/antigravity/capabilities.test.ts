import type { ProviderHost } from '@/core/providers/ProviderHost';
import { antigravityProviderCapabilities } from '@/providers/antigravity/capabilities';
import { antigravityProviderRegistration } from '@/providers/antigravity/registration';

function createPlugin(): ProviderHost {
  return {
    app: { vault: { adapter: { basePath: '/tmp/antigravity-vault' } } },
    settings: { providerConfigs: { antigravity: { enabled: false } } },
  } as unknown as ProviderHost;
}

describe('Antigravity provider capabilities', () => {
  it('reports every unverified capability as absent rather than assumed', () => {
    // A0 (2026-09-18) verified per-turn print mode only. Nothing else may be
    // turned on without fresh protocol evidence; a CLI flag in `agy --help`
    // is not an implemented plugin contract.
    expect(antigravityProviderCapabilities).toEqual({
      providerId: 'antigravity',
      supportsPersistentRuntime: false,
      supportsNativeHistory: false,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: false,
      supportsInstructionMode: false,
      supportsMcpTools: false,
      supportsSharedAgentSkills: false,
      supportsTurnSteer: false,
      reasoningControl: 'none',
    });
  });

  it('is frozen and shared with the registration and the runtime', () => {
    expect(Object.isFrozen(antigravityProviderCapabilities)).toBe(true);
    expect(antigravityProviderRegistration.capabilities).toBe(antigravityProviderCapabilities);

    const runtime = antigravityProviderRegistration.createRuntime({ plugin: createPlugin() });
    expect(runtime.getCapabilities()).toBe(antigravityProviderCapabilities);
    runtime.cleanup();
  });
});
