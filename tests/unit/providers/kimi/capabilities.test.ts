import { KIMI_PROVIDER_CAPABILITIES } from '@/providers/kimi/capabilities';

describe('Kimi provider capabilities', () => {
  it('reflects the probed Kimi ACP surface', () => {
    expect(KIMI_PROVIDER_CAPABILITIES).toMatchObject({
      providerId: 'kimi',
      supportsPersistentRuntime: true,
      supportsNativeHistory: true,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: true,
      supportsImageAttachments: true,
      supportsInstructionMode: true,
      supportsMcpTools: true,
      supportsSharedAgentSkills: false,
      supportsTurnSteer: false,
      reasoningControl: 'none',
    });
  });
});
