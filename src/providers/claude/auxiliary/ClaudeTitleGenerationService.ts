import {
  type BackgroundRequestGate,
  buildLocalFallbackTitle,
  getSharedBackgroundRequestGate,
} from '../../../core/auxiliary/AuxiliaryRequestPolicy';
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
    const gate = getSharedBackgroundRequestGate();
    if (gate && !gate.allowsAutomaticTask('auto-title')) {
      await this.deliverLocalTitle(conversationId, userMessage, callback);
      return;
    }

    await this.runGeneration(conversationId, userMessage, callback, gate ?? undefined);
  }

  /**
   * Manual, user-triggered regeneration. The saving-mode policy and the daily
   * background request budget do not apply, because the user asked for it.
   */
  async generateTitleManually(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback
  ): Promise<void> {
    await this.runGeneration(conversationId, userMessage, callback, undefined);
  }

  /** Model-free degradation used when the gate blocks the background request. */
  private async deliverLocalTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback
  ): Promise<void> {
    await this.safeCallback(callback, conversationId, {
      success: true,
      title: buildLocalFallbackTitle(userMessage),
    });
  }

  private async runGeneration(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
    gate?: BackgroundRequestGate
  ): Promise<void> {
    // Cancel any existing generation for this conversation
    const existingController = this.activeGenerations.get(conversationId);
    if (existingController) {
      existingController.abort();
    }

    const abortController = new AbortController();
    if (gate) {
      const rejection = gate.tryBegin(abortController.signal);
      if (rejection !== null) {
        await this.deliverLocalTitle(conversationId, userMessage, callback);
        return;
      }
    }
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
      gate?.end();
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
