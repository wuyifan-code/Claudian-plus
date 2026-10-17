import type { ProviderCapabilities } from '../../core/providers/types';

export const dshProviderCapabilities: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'dsh',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: false,
  supportsImageAttachments: false,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsSharedAgentSkills: false,
  supportsTurnSteer: false,
  reasoningControl: 'effort',
});
