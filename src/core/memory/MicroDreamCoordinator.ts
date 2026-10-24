import type { BackgroundRequestGate } from '../auxiliary/AuxiliaryRequestPolicy';
import type { AuxQueryRunner } from '../auxiliary/AuxQueryRunner';
import {
  buildMicroDreamPrompt,
  MICRO_DREAM_SYSTEM_PROMPT,
  parseMicroDreamResponse,
} from '../prompt/dreamMemory';
import type { ProviderId } from '../providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../providers/types';
import { canonicalClaimKey } from './v2/claimKey';
import type { MemoryRepository } from './v2/MemoryRepository';
import type { MemoryKind, MemoryScope } from './v2/types';

export interface SessionMessageInput {
  role: string;
  content?: unknown;
}

export interface SessionEvaluationInput {
  id: string;
  messages: SessionMessageInput[];
  hasToolCalls?: boolean;
  projectContext?: string;
}

export interface MicroDreamRunResult {
  ran: boolean;
  reason?: 'disabled' | 'insubstantial' | 'no-new-rules' | 'failed' | 'redundant'
    | 'saving-mode' | 'budget-exceeded' | 'busy';
  newStagingCount: number;
  error?: string;
}

export interface MicroDreamCoordinatorDependencies {
  repository: MemoryRepository;
  vaultId: string;
  createRunner: (providerId: ProviderId) => AuxQueryRunner;
  getConversationContext?: () => { providerId: ProviderId; model: string | null } | null;
  isEnabled?: () => boolean;
  /** Shared saving-mode policy + daily budget consulted for automatic evaluations. */
  backgroundRequestGate?: BackgroundRequestGate;
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

function ruleKind(category: string): MemoryKind {
  switch (category) {
    case 'project_rule':
      return 'project_state';
    case 'coding_habit':
    case 'correction_rule':
      return 'lesson';
    default:
      return 'profile';
  }
}

export class MicroDreamCoordinator {
  private readonly minTurns: number;
  private readonly maxTrajectoryChars: number;
  private readonly lastEvaluatedWatermarks = new Map<string, number>();
  private readonly inFlightEvaluations = new Map<string, Promise<MicroDreamRunResult>>();

  constructor(
    private readonly deps: MicroDreamCoordinatorDependencies,
  ) {
    this.minTurns = deps.minTurns ?? 3;
    this.maxTrajectoryChars = deps.maxTrajectoryChars ?? 6000;
  }

  getLastEvaluatedTurnCount(sessionId: string): number | undefined {
    return this.lastEvaluatedWatermarks.get(sessionId);
  }

  clearWatermark(sessionId?: string): void {
    if (sessionId) {
      this.lastEvaluatedWatermarks.delete(sessionId);
    } else {
      this.lastEvaluatedWatermarks.clear();
    }
  }

  async evaluateSession(session: SessionEvaluationInput): Promise<MicroDreamRunResult> {
    if (this.deps.isEnabled && !this.deps.isEnabled()) {
      return { ran: false, reason: 'disabled', newStagingCount: 0 };
    }

    const gate = this.deps.backgroundRequestGate;
    if (gate && !gate.allowsAutomaticTask('auto-micro-dream')) {
      return { ran: false, reason: 'saving-mode', newStagingCount: 0 };
    }

    const inFlight = this.inFlightEvaluations.get(session.id);
    if (inFlight) {
      return inFlight;
    }

    const runPromise = this.doEvaluateSession(session);
    this.inFlightEvaluations.set(session.id, runPromise);
    try {
      return await runPromise;
    } finally {
      this.inFlightEvaluations.delete(session.id);
    }
  }

  private async doEvaluateSession(session: SessionEvaluationInput): Promise<MicroDreamRunResult> {
    const userTurns = session.messages.filter((m) => m.role === 'user').length;
    const isSubstantial = userTurns >= this.minTurns || session.hasToolCalls === true;

    if (!isSubstantial) {
      return { ran: false, reason: 'insubstantial', newStagingCount: 0 };
    }

    const lastWatermark = this.lastEvaluatedWatermarks.get(session.id);
    if (lastWatermark !== undefined && userTurns <= lastWatermark) {
      return { ran: false, reason: 'redundant', newStagingCount: 0 };
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

      // Existing memories prevent re-extracting known facts
      const activeRecords = await this.deps.repository.listRecords({ status: 'active' });
      const candidateRecords = await this.deps.repository.listRecords({ status: 'candidate' });
      const existingRulesText = [...activeRecords, ...candidateRecords]
        .map((r) => `- [${r.kind}] (${r.claimKey}) ${r.content}`)
        .join('\n');

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

      const gate = this.deps.backgroundRequestGate;
      const budgetRejection = gate ? gate.tryBegin() : null;
      if (budgetRejection !== null) {
        return {
          ran: false,
          reason: budgetRejection === 'busy' ? 'busy' : 'budget-exceeded',
          newStagingCount: 0,
        };
      }
      try {
        return await this.runMicroDreamQuery(session, userPrompt, providerContext, userTurns);
      } finally {
        gate?.end();
      }
    } catch (err) {
      return {
        ran: false,
        reason: 'failed',
        newStagingCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async runMicroDreamQuery(
    session: SessionEvaluationInput,
    userPrompt: string,
    providerContext: { providerId: ProviderId; model: string | null },
    userTurns: number,
  ): Promise<MicroDreamRunResult> {
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
    this.lastEvaluatedWatermarks.set(session.id, session.messages.filter((m) => m.role === 'user').length);
    if (parsed.rules.length === 0) {
      return { ran: true, reason: 'no-new-rules', newStagingCount: 0 };
    }

    let addedCount = 0;
    for (const rule of parsed.rules) {
      const kind = ruleKind(rule.category);
      const scope: MemoryScope = { vaultId: this.deps.vaultId };
      const claimKey = canonicalClaimKey(kind, rule.content);
      // Micro-dream proposals become V2 candidates: they are only injected
      // after the user approves them in settings.
      const added = await this.deps.repository.commitCandidate({
        kind,
        claimKey,
        content: rule.content,
        scope,
        basis: 'inferred',
        rationale: rule.rationale,
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
  }
}
