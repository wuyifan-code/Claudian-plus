import { appendContextFiles } from '../../utils/context';
import {
  buildInlineEditPrompt,
  getInlineEditSystemPrompt,
  parseInlineEditResponse,
} from '../prompt/inlineEdit';
import type {
  InlineEditRequest,
  InlineEditResult,
  InlineEditService,
} from '../providers/types';
import type { AuxQueryRunner } from './AuxQueryRunner';

export class QueryBackedInlineEditService implements InlineEditService {
  private abortController: AbortController | null = null;
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

  async editText(request: InlineEditRequest): Promise<InlineEditResult> {
    this.resetConversation();
    return this.sendMessage(buildInlineEditPrompt(request));
  }

  async continueConversation(message: string, contextFiles?: string[]): Promise<InlineEditResult> {
    if (!this.hasConversation) {
      return { success: false, error: 'No active conversation to continue' };
    }

    let prompt = message;
    if (contextFiles && contextFiles.length > 0) {
      prompt = appendContextFiles(message, contextFiles);
    }
    return this.sendMessage(prompt);
  }

  cancel(): void {
    this.invalidateActiveRequest();
  }

  private async sendMessage(prompt: string): Promise<InlineEditResult> {
    this.abortController?.abort();
    const requestGeneration = ++this.requestGeneration;
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const text = await this.runner.query({
        abortController,
        model: this.modelOverride,
        systemPrompt: getInlineEditSystemPrompt(),
      }, prompt);
      if (this.requestGeneration !== requestGeneration || abortController.signal.aborted) {
        return { success: false, error: 'Cancelled' };
      }
      this.hasConversation = true;
      return parseInlineEditResponse(text);
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
