import '@/providers';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import {
  ANTIGRAVITY_INSTRUCTION_REFINE_UNAVAILABLE,
  AntigravityInstructionRefineService,
} from '@/providers/antigravity/auxiliary/AntigravityInstructionRefineService';
import { antigravityProviderCapabilities } from '@/providers/antigravity/capabilities';
import { antigravityProviderRegistration } from '@/providers/antigravity/registration';

describe('AntigravityInstructionRefineService', () => {
  it('reports an explicit unavailable result instead of a fabricated success', async () => {
    const service = new AntigravityInstructionRefineService();
    const onProgress = jest.fn();

    await expect(service.refineInstruction('write tests first', 'be concise', onProgress))
      .resolves.toEqual({
        success: false,
        error: ANTIGRAVITY_INSTRUCTION_REFINE_UNAVAILABLE,
      });
    await expect(service.continueConversation('and keep them fast', onProgress))
      .resolves.toEqual({
        success: false,
        error: ANTIGRAVITY_INSTRUCTION_REFINE_UNAVAILABLE,
      });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('resets and cancels as no-ops for a capability that does not exist', () => {
    const service = new AntigravityInstructionRefineService();
    expect(() => service.resetConversation()).not.toThrow();
    expect(() => service.cancel()).not.toThrow();
  });

  it('is registered for a provider whose UI hides the instruction entry point', async () => {
    // The capability is what hides the entry point; the service result is the
    // second line of defence if a caller ever reaches it anyway.
    expect(antigravityProviderCapabilities.supportsInstructionMode).toBe(false);

    const service = ProviderRegistry.createInstructionRefineService(
      {} as ProviderHost,
      'antigravity',
    );
    await expect(service.refineInstruction('anything', '')).resolves.toMatchObject({
      success: false,
    });
    expect(service).toBeInstanceOf(AntigravityInstructionRefineService);
    expect(antigravityProviderRegistration.createInstructionRefineService({} as ProviderHost))
      .toBeInstanceOf(AntigravityInstructionRefineService);
  });
});
