import { DshInstructionRefineService } from '@/providers/dsh/auxiliary/DshInstructionRefineService';
import { DshTitleGenerationService } from '@/providers/dsh/auxiliary/DshTitleGenerationService';
import { dshProviderCapabilities } from '@/providers/dsh/capabilities';

describe('DeepSeek Harness conservative service contract', () => {
  it('creates deterministic titles locally and reports refinement unavailable', async () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    await new DshTitleGenerationService().generateTitle('conversation', '\n Fix   this issue\nrest', callback);
    expect(callback).toHaveBeenCalledWith('conversation', { success: true, title: 'Fix this issue' });
    const refine = new DshInstructionRefineService();
    expect(await refine.refineInstruction('raw', 'existing')).toMatchObject({ success: false, error: expect.stringContaining('unavailable') });
    expect(await refine.continueConversation('more')).toMatchObject({ success: false });
  });

  it('does not expose unqualified shared features', () => {
    expect(dshProviderCapabilities).toEqual({
      providerId: 'dsh', supportsPersistentRuntime: true, supportsNativeHistory: true,
      supportsPlanMode: false, supportsRewind: false, supportsFork: false, supportsProviderCommands: false,
      supportsImageAttachments: false, supportsInstructionMode: false, supportsMcpTools: false,
      supportsSharedAgentSkills: false, supportsTurnSteer: false, reasoningControl: 'effort',
    });
  });
});
