import { DSH_PROVIDER_CAPABILITIES } from '@/providers/dsh/capabilities';

describe('DSH_PROVIDER_CAPABILITIES', () => {
  it('declares the ACP baseline surface', () => {
    expect(DSH_PROVIDER_CAPABILITIES.providerId).toBe('dsh');
    expect(DSH_PROVIDER_CAPABILITIES.supportsPersistentRuntime).toBe(true);
    expect(DSH_PROVIDER_CAPABILITIES.supportsNativeHistory).toBe(false);
    expect(DSH_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(false);
    expect(DSH_PROVIDER_CAPABILITIES.supportsRewind).toBe(false);
    expect(DSH_PROVIDER_CAPABILITIES.supportsFork).toBe(false);
    expect(DSH_PROVIDER_CAPABILITIES.supportsProviderCommands).toBe(false);
    expect(DSH_PROVIDER_CAPABILITIES.supportsImageAttachments).toBe(false);
    expect(DSH_PROVIDER_CAPABILITIES.supportsInstructionMode).toBe(false);
    expect(DSH_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
    expect(DSH_PROVIDER_CAPABILITIES.supportsSharedAgentSkills).toBe(true);
    expect(DSH_PROVIDER_CAPABILITIES.reasoningControl).toBe('effort');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DSH_PROVIDER_CAPABILITIES)).toBe(true);
  });
});
