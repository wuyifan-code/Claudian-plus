import type { AuxQueryRunner } from '../auxiliary/AuxQueryRunner';
import {
  buildMicroDreamPrompt,
  MICRO_DREAM_SYSTEM_PROMPT,
  parseMicroDreamResponse,
} from '../prompt/dreamMemory';
import type { ProviderId } from '../providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../providers/types';
import type { MemoryStore } from './MemoryStore';
import type { MindStore } from './MindStore';

export interface SessionMessageInput {
  role: string;
  content?: string | unknown[] | unknown;
}

export interface SessionEvaluationInput {
  id: string;
  messages: SessionMessageInput[];
  hasToolCalls?: boolean;
  projectContext?: string;
}

export interface MicroDreamRunResult {
  ran: boolean;
  reason?: 'disabled' | 'insubstantial' | 'no-new-rules' | 'failed';
  newStagingCount: number;
  error?: string;
}

export interface MicroDreamCoordinatorDependencies {
  mindStore: MindStore;
  createRunner: (providerId: ProviderId) => AuxQueryRunner;
  getConversationContext?: () => { providerId: ProviderId; model: string | null } | null;
  getMemoryStore?: () => MemoryStore | null;
  isEnabled?: () => boolean;
  minTurns?: number;
  maxTrajectoryChars?: number;
  onNewStaging?: (count: number) => void;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text: unknown }).text ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export class MicroDreamCoordinator {
  private readonly minTurns: number;
  private readonly maxTrajectoryChars: number;

  constructor(private readonly deps: MicroDreamCoordinatorDependencies) {
    this.minTurns = deps.minTurns ?? 3;
    this.maxTrajectoryChars = deps.maxTrajectoryChars ?? 6000;
    if (deps.getMemoryStore) {
      deps.mindStore.setMemoryStoreProvider(deps.getMemoryStore);
    }
  }

  async evaluateSession(session: SessionEvaluationInput): Promise<MicroDreamRunResult> {
    if (this.deps.isEnabled && !this.deps.isEnabled()) {
      return { ran: false, reason: 'disabled', newStagingCount: 0 };
    }

    const userTurns = session.messages.filter((m) => m.role === 'user').length;
    const isSubstantial = userTurns >= this.minTurns || session.hasToolCalls === true;

    if (!isSubstantial) {
      return { ran: false, reason: 'insubstantial', newStagingCount: 0 };
    }

    try {
      // Build conversation trajectory text
      const trajectoryLines: string[] = [];
      for (const msg of session.messages) {
        const text = stringifyMessageContent(msg.content);
        if (text) {
          const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
          trajectoryLines.push(`${roleLabel}: ${text}`);
        }
      }
      const trajectoryText = trajectoryLines.join('\n\n');
      if (!trajectoryText.trim()) {
        return { ran: false, reason: 'insubstantial', newStagingCount: 0 };
      }

      // Fetch existing durable rules to prevent re-extracting known rules
      const durableRules = await this.deps.mindStore.listDurable('project');
      const globalRules = await this.deps.mindStore.listDurable('global');
      const memoryEntries = (await this.deps.getMemoryStore?.()?.load()) ?? [];
      const memoryRulesText = memoryEntries.map((m) => `- [${m.category}] ${m.content}`);
      const existingRulesText = [
        ...globalRules.map((r) => `- [${r.category}] (${r.scope}) ${r.content}`),
        ...durableRules.map((r) => `- [${r.category}] (${r.scope}) ${r.content}`),
        ...memoryRulesText,
      ].join('\n');

      const userPrompt = buildMicroDreamPrompt({
        trajectoryText,
        existingRulesText,
        projectContext: session.projectContext,
        maxChars: this.maxTrajectoryChars,
      });

      const providerContext = this.deps.getConversationContext?.() ?? {
        providerId: DEFAULT_CHAT_PROVIDER_ID,
        model: null,
      };

      const runner = this.deps.createRunner(providerContext.providerId);
      const abortController = new AbortController();
      const timeoutId = window.setTimeout(
        () => abortController.abort(),
        60_000,
      );
      let response: string;
      try {
        response = await runner.query(
          {
            systemPrompt: MICRO_DREAM_SYSTEM_PROMPT,
            model: providerContext.model ?? undefined,
            abortController,
          },
          userPrompt,
        );
      } finally {
        window.clearTimeout(timeoutId);
        runner.reset();
      }

      const parsed = parseMicroDreamResponse(response);
      if (parsed.rules.length === 0) {
        return { ran: true, reason: 'no-new-rules', newStagingCount: 0 };
      }

      let addedCount = 0;
      for (const rule of parsed.rules) {
        const added = await this.deps.mindStore.addStaging({
          category: rule.category,
          scope: rule.scope,
          content: rule.content,
          rationale: rule.rationale,
          sourceSessionId: session.id,
          confidence: rule.confidence,
        });
        if (added) {
          addedCount++;
        }
      }

      if (addedCount > 0 && this.deps.onNewStaging) {
        try {
          this.deps.onNewStaging(addedCount);
        } catch {
          // Callback errors should not fail synthesis result
        }
      }

      return {
        ran: true,
        newStagingCount: addedCount,
      };
    } catch (err) {
      return {
        ran: false,
        reason: 'failed',
        newStagingCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
