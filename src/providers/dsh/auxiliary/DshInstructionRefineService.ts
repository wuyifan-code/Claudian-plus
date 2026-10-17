import type { InstructionRefineService } from '../../../core/providers/types';
import type { InstructionRefineResult } from '../../../core/types';

export const DSH_INSTRUCTION_REFINE_UNAVAILABLE = 'Instruction refinement is unavailable for DeepSeek Harness.';

export class DshInstructionRefineService implements InstructionRefineService {
  resetConversation(): void {}

  async refineInstruction(_raw: string, _existing: string): Promise<InstructionRefineResult> {
    return { success: false, error: DSH_INSTRUCTION_REFINE_UNAVAILABLE };
  }

  async continueConversation(_message: string): Promise<InstructionRefineResult> {
    return { success: false, error: DSH_INSTRUCTION_REFINE_UNAVAILABLE };
  }

  cancel(): void {}
}
