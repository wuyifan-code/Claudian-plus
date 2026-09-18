import {
  buildTitleGenerationPrompt,
  parseTitleGenerationResponse,
  TITLE_GENERATION_SYSTEM_PROMPT,
} from '../prompt/titleGeneration';
import type {
  TitleGenerationCallback,
  TitleGenerationResult,
  TitleGenerationService,
} from '../providers/types';
import {
  type BackgroundRequestGate,
  buildLocalFallbackTitle,
  getSharedBackgroundRequestGate,
} from './AuxiliaryRequestPolicy';
import type { AuxQueryRunner } from './AuxQueryRunner';

interface ActiveGeneration {
  abortController: AbortController;
  runner: AuxQueryRunner;
  /** Set while this generation holds a background budget slot. */
  gate?: BackgroundRequestGate;
}

export interface QueryBackedTitleGenerationServiceOptions {
  createRunner: () => AuxQueryRunner;
  resolveModel?: () => string | undefined;
  /**
   * Gate consulted before issuing the background title request. When omitted,
   * the shared gate assembled by the plugin is used; an explicit `null`
   * disables gating.
   */
  backgroundRequestGate?: BackgroundRequestGate | null;
}

export class QueryBackedTitleGenerationService implements TitleGenerationService {
  private readonly activeGenerations = new Map<string, ActiveGeneration>();

  constructor(private readonly options: QueryBackedTitleGenerationServiceOptions) {}

  /**
   * Manual, user-triggered regeneration: the saving-mode policy and the daily
   * background budget do not apply, because the user asked for this request.
   */
  async generateTitleManually(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    await this.runTitleGeneration(conversationId, userMessage, callback, null);
  }

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    await this.runTitleGeneration(conversationId, userMessage, callback);

  }

  private async runTitleGeneration(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
    gateOverride?: BackgroundRequestGate | null,
  ): Promise<void> {
    const existing = this.activeGenerations.get(conversationId);
    if (existing) {
      existing.abortController.abort();
      existing.runner.reset();
      existing.gate?.end();
      existing.gate = undefined;
    }

    const gate = gateOverride !== undefined
      ? gateOverride
      : this.options.backgroundRequestGate !== undefined
      ? this.options.backgroundRequestGate
      : getSharedBackgroundRequestGate();
    if (gate && !gate.allowsAutomaticTask('auto-title')) {
      await this.deliverLocalTitle(callback, conversationId, userMessage);
      return;
    }

    const abortController = new AbortController();
    if (gate) {
      const rejection = gate.tryBegin(abortController.signal);
      if (rejection !== null) {
        await this.deliverLocalTitle(callback, conversationId, userMessage);
        return;
      }
    }
    const runner = this.options.createRunner();
    const generation: ActiveGeneration = { abortController, runner, gate: gate ?? undefined };
    this.activeGenerations.set(conversationId, generation);

    try {
      const text = await runner.query({
        abortController,
        model: this.options.resolveModel?.(),
        systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
      }, buildTitleGenerationPrompt(userMessage));
      if (this.activeGenerations.get(conversationId) !== generation || abortController.signal.aborted) {
        return;
      }
      const title = parseTitleGenerationResponse(text);
      await this.safeCallback(
        callback,
        conversationId,
        title
          ? { success: true, title }
          : { success: false, error: 'Failed to parse title from response' },
      );
    } catch (error) {
      if (this.activeGenerations.get(conversationId) !== generation || abortController.signal.aborted) {
        return;
      }
      await this.safeCallback(callback, conversationId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      generation.gate?.end();
      generation.gate = undefined;
      runner.reset();
      if (this.activeGenerations.get(conversationId) === generation) {
        this.activeGenerations.delete(conversationId);
      }
    }
  }

  cancel(): void {
    for (const active of this.activeGenerations.values()) {
      active.abortController.abort();
      active.runner.reset();
    }
    this.activeGenerations.clear();
  }

  /** Model-free degradation used when the gate blocks the background request. */
  private async deliverLocalTitle(
    callback: TitleGenerationCallback,
    conversationId: string,
    userMessage: string,
  ): Promise<void> {
    await this.safeCallback(callback, conversationId, {
      success: true,
      title: buildLocalFallbackTitle(userMessage),
    });
  }

  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult,
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch {
      // Ignore callback failures to match existing service behavior.
    }
  }
}
