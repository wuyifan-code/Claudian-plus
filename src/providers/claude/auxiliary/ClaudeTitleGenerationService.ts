import {
  buildTitleGenerationPrompt,
  parseTitleGenerationResponse,
  TITLE_GENERATION_SYSTEM_PROMPT,
} from '../../../core/prompt/titleGeneration';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type {
  TitleGenerationCallback,
  TitleGenerationResult,
} from '../../../core/providers/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { toClaudeRuntimeModelId } from '../modelSelection';
import { runColdStartQuery } from '../runtime/claudeColdStartQuery';
import { claudeChatUIConfig } from '../ui/ClaudeChatUIConfig';

export type { TitleGenerationResult };

export class TitleGenerationService {
  private plugin: ProviderHost;
  private activeGenerations: Map<string, AbortController> = new Map();

  constructor(plugin: ProviderHost) {
    this.plugin = plugin;
  }

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback
  ): Promise<void> {
    // Cancel any existing generation for this conversation
    const existingController = this.activeGenerations.get(conversationId);
    if (existingController) {
      existingController.abort();
    }

    const abortController = new AbortController();
    this.activeGenerations.set(conversationId, abortController);

    const prompt = buildTitleGenerationPrompt(userMessage);

    try {
      const result = await runColdStartQuery({
        plugin: this.plugin,
        systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
        tools: [],
        model: this.resolveTitleModel(),
        thinking: { disabled: true },
        persistSession: false,
        abortController,
      }, prompt);

      const title = parseTitleGenerationResponse(result.text);
      if (title) {
        await this.safeCallback(callback, conversationId, { success: true, title });
      } else {
        await this.safeCallback(callback, conversationId, {
          success: false,
          error: 'Failed to parse title from response',
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      await this.safeCallback(callback, conversationId, { success: false, error: msg });
    } finally {
      this.activeGenerations.delete(conversationId);
    }
  }

  cancel(): void {
    for (const controller of this.activeGenerations.values()) {
      controller.abort();
    }
    this.activeGenerations.clear();
  }

  private resolveTitleModel(): string {
    const envVars = parseEnvironmentVariables(
      this.plugin.getActiveEnvironmentVariables('claude')
    );
    const titleModel = this.plugin.settings.titleGenerationModel;
    if (titleModel && claudeChatUIConfig.ownsModel(
      titleModel,
      this.plugin.settings,
    )) {
      return toClaudeRuntimeModelId(titleModel);
    }

    return (
      envVars.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
      'claude-haiku-4-5'
    );
  }

  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch {
      // Silently ignore callback errors
    }
  }
}
