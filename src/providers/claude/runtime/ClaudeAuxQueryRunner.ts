import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { runColdStartQuery } from './claudeColdStartQuery';

/**
 * AuxQueryRunner adapter for Claude, wrapping the lightweight cold-start query
 * so provider-neutral auxiliary services (title generation, dreaming) can call
 * Claude without touching the chat runtime.
 */
export class ClaudeAuxQueryRunner implements AuxQueryRunner {
  constructor(private readonly plugin: ProviderHost) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const result = await runColdStartQuery({
      plugin: this.plugin,
      systemPrompt: config.systemPrompt,
      tools: [],
      model: config.model,
      thinking: { disabled: true },
      persistSession: false,
      abortController: config.abortController,
      onTextChunk: config.onTextChunk,
    }, prompt);
    return result.text;
  }

  reset(): void {
    // Each cold-start query already runs a fresh, non-persistent session.
  }
}
