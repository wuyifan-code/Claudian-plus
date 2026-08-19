import type { AgentSkillContext } from '../skills/AgentSkillContext';

export interface AuxQueryConfig {
  systemPrompt: string;
  model?: string;
  agentSkillContext?: AgentSkillContext;
  abortController?: AbortController;
  onTextChunk?: (accumulatedText: string) => void;
}

export interface AuxQueryRunner {
  query(config: AuxQueryConfig, prompt: string): Promise<string>;
  reset(): void;
}
