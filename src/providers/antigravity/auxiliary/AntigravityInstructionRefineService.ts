import type { InstructionRefineService, RefineProgressCallback } from '../../../core/providers/types';
import type { InstructionRefineResult } from '../../../core/types';

/** Why instruction refinement is not offered for Antigravity. */
export const ANTIGRAVITY_INSTRUCTION_REFINE_UNAVAILABLE =
  'Antigravity does not implement instruction refinement. The feature is unavailable for this provider.';

/**
 * Explicitly unavailable instruction refine service.
 *
 * Antigravity has no verified instruction-mode or auxiliary query path, so this
 * service never tries, never guesses, and never reports a fabricated success: it
 * returns the shared failure shape with a stated reason. The UI is hidden for
 * this provider through `capabilities.supportsInstructionMode: false`, and this
 * result is the second line of defence if that entry point is ever reached.
 */
export class AntigravityInstructionRefineService implements InstructionRefineService {
  resetConversation(): void {
    // No conversation state exists for an unavailable capability.
  }

  async refineInstruction(
    _rawInstruction: string,
    _existingInstructions: string,
    _onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: false, error: ANTIGRAVITY_INSTRUCTION_REFINE_UNAVAILABLE };
  }

  async continueConversation(
    _message: string,
    _onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: false, error: ANTIGRAVITY_INSTRUCTION_REFINE_UNAVAILABLE };
  }

  cancel(): void {
    // Nothing is in flight.
  }
}
