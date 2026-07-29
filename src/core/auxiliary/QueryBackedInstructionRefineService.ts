import { buildRefineSystemPrompt, parseInstructionRefineResponse } from '../prompt/instructionRefine';
import type {
  InstructionRefineService,
  RefineProgressCallback,
} from '../providers/types';
import type { InstructionRefineResult } from '../types';
import type { AuxQueryRunner } from './AuxQueryRunner';

export class QueryBackedInstructionRefineService implements InstructionRefineService {
  private abortController: AbortController | null = null;
  private existingInstructions = '';
  private hasConversation = false;
  private modelOverride: string | undefined;
  private requestGeneration = 0;

  constructor(private readonly runner: AuxQueryRunner) {}

  setModelOverride(model?: string): void {
    const trimmed = model?.trim();
    this.modelOverride = trimmed ? trimmed : undefined;
  }

  resetConversation(): void {
    this.invalidateActiveRequest();
    this.runner.reset();
    this.hasConversation = false;
  }

  async refineInstruction(
    rawInstruction: string,
    existingInstructions: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    this.resetConversation();
    this.existingInstructions = existingInstructions;
    return this.sendMessage(`Please refine this instruction: "${rawInstruction}"`, onProgress);
  }

  async continueConversation(
    message: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    if (!this.hasConversation) {
      return { success: false, error: 'No active conversation to continue' };
    }
    return this.sendMessage(message, onProgress);
  }

  cancel(): void {
    this.invalidateActiveRequest();
  }

  private async sendMessage(
    prompt: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    this.abortController?.abort();
    const requestGeneration = ++this.requestGeneration;
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const text = await this.runner.query({
        abortController,
        model: this.modelOverride,
        onTextChunk: onProgress
          ? (accumulatedText: string) => {
            if (this.requestGeneration !== requestGeneration || abortController.signal.aborted) {
              return;
            }
            onProgress(parseInstructionRefineResponse(accumulatedText));
          }
          : undefined,
        systemPrompt: buildRefineSystemPrompt(this.existingInstructions),
      }, prompt);
      if (this.requestGeneration !== requestGeneration || abortController.signal.aborted) {
        return { success: false, error: 'Cancelled' };
      }
      this.hasConversation = true;
      return parseInstructionRefineResponse(text);
    } catch (error) {
      if (this.requestGeneration !== requestGeneration || abortController.signal.aborted) {
        return { success: false, error: 'Cancelled' };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      if (this.requestGeneration === requestGeneration && this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  private invalidateActiveRequest(): void {
    this.requestGeneration += 1;
    this.abortController?.abort();
    this.abortController = null;
  }
}
