import type { ProviderCapabilities } from '../../core/providers/types';

export const DSH_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'dsh',
  supportsPersistentRuntime: true,
  supportsNativeHistory: false,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: false,
  supportsImageAttachments: false,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsSharedAgentSkills: true,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});
