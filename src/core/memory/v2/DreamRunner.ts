import type { AuxQueryRunner } from '../../auxiliary/AuxQueryRunner';
import type { ProviderId } from '../../providers/types';
import { resolveClaimKey, sanitizeKeywords } from './claimKey';
import type { MemoryRepository } from './MemoryRepository';
import type {
  DreamJob,
  DreamProposal,
  EpisodeRecord,
  KeywordAnnotation,
  MemoryRecord,
} from './types';

export interface DreamRunnerOptions {
  repository: MemoryRepository;
  vaultId: string;
  createRunner: (providerId: ProviderId) => AuxQueryRunner;
  maxInputChars?: number;
  maxEpisodesPerJob?: number;
  queryTimeoutMs?: number;
}

export interface DreamRunOutput {
  ran: boolean;
  reason?: 'no_new_episodes' | 'budget_exceeded' | 'failed';
  error?: string;
  appliedCount?: number;
  rejectedCount?: number;
  proposals?: DreamProposal[];
  keywordAnnotations?: KeywordAnnotation[];
}

export interface PreparedDreamInput {
  episodes: EpisodeRecord[];
  existingMemories: MemoryRecord[];
  keywordlessMemories: MemoryRecord[];
  fromEventId?: string;
  toEventId?: string;
  inputLength: number;
}

export const DREAM_SYSTEM_PROMPT = `You are the Memory Consolidation Engine for an AI coding assistant.
Analyze new conversation episodes against existing memories.
Synthesize stable user preferences, project facts, and verified lessons learned.

Output strictly valid JSON matching this schema:
{
  "proposals": [
    {
      "action": "add" | "merge" | "supersede" | "contest" | "archive" | "no_op",
      "kind": "profile" | "project_state" | "lesson",
      "claimKey": "namespace.identifier (e.g. project.package_manager, user.language, fix.sqlite_warning)",
      "content": "concise description of the fact or preference",
      "basis": "explicit" | "observed" | "inferred",
      "conditions": ["optional matching condition tags"],
      "outcome": "succeeded" | "failed" | "unknown",
      "keywords": ["3-8 lowercase search keywords in the user's language"],
      "evidence": [
        {
          "rootEventId": "id of the episode providing evidence",
          "eventRevision": "revision of episode",
          "providerId": "provider id",
          "conversationId": "conversation id",
          "messageId": "message id",
          "span": { "start": 0, "end": 100 },
          "sourceClass": "user" | "tool_result" | "assistant"
        }
      ]
    }
  ],
  "keywordAnnotations": [
    { "id": "existing memory id that lacks keywords", "keywords": ["3-8 keywords"] }
  ]
}

CRITICAL RULES:
1. Do not invent facts. Every fact MUST have verifiable evidence from the episodes.
2. An assistant claiming "I fixed it" is NOT proof of success. Outcome is only "succeeded" if confirmed by a tool_result or user statement.
3. claimKey stability: when re-stating, merging, or updating a fact that already exists in "Existing Active Memories", REUSE that record's claimKey verbatim. Invent a new namespaced key only for genuinely new facts.
4. Every proposal MUST include "keywords": 3-8 lowercase search terms a future query would likely use (in the user's language, e.g. Chinese).
5. For existing memories listed with "(no keywords)", fill "keywordAnnotations" with their id and keywords. Skip this array entirely when there are none.
6. If there are no new facts or changes, return "proposals": [].`;

export class DreamRunner {
  private readonly repo: MemoryRepository;
  private readonly vaultId: string;
  private readonly createRunner: (providerId: ProviderId) => AuxQueryRunner;
  private readonly maxInputChars: number;
  private readonly maxEpisodesPerJob: number;
  private readonly queryTimeoutMs: number;

  constructor(options: DreamRunnerOptions) {
    this.repo = options.repository;
    this.vaultId = options.vaultId;
    this.createRunner = options.createRunner;
    this.maxInputChars = options.maxInputChars ?? 6000;
    this.maxEpisodesPerJob = options.maxEpisodesPerJob ?? 20;
    this.queryTimeoutMs = options.queryTimeoutMs ?? 60_000;
  }

  async prepareDreamInput(job: DreamJob): Promise<PreparedDreamInput> {
    const checkpoints = await this.repo.getCheckpoints();
    const allEpisodes = await this.repo.listEpisodes();

    let startIndex = 0;
    if (checkpoints.lastAdjudicatedEventId) {
      const lastIndex = allEpisodes.findIndex(
        (e) => e.id === checkpoints.lastAdjudicatedEventId,
      );
      if (lastIndex >= 0) {
        startIndex = lastIndex + 1;
      }
    }

    const unadjudicated = allEpisodes.slice(startIndex);
    const selectedEpisodes: EpisodeRecord[] = [];
    let currentChars = 0;

    for (const ep of unadjudicated) {
      const epCharCount = ep.content.length + JSON.stringify(ep.toolCalls ?? []).length + 100;
      if (
        selectedEpisodes.length > 0 &&
        (currentChars + epCharCount > this.maxInputChars ||
          selectedEpisodes.length >= this.maxEpisodesPerJob)
      ) {
        break; // Stop at episode boundary
      }
      selectedEpisodes.push(ep);
      currentChars += epCharCount;
      if (selectedEpisodes.length >= this.maxEpisodesPerJob) {
        break;
      }
    }

    const existingMemories = (await this.repo.listRecords({ status: 'active' })).slice(-30);
    const keywordlessMemories = existingMemories
      .filter((m) => !m.keywords || m.keywords.length === 0)
      .slice(-20);

    return {
      episodes: selectedEpisodes,
      existingMemories,
      keywordlessMemories,
      fromEventId: selectedEpisodes[0]?.id,
      toEventId: selectedEpisodes[selectedEpisodes.length - 1]?.id,
      inputLength: currentChars,
    };
  }

  /**
   * Cheap local-IO check used by the coordinator to close out queued jobs
   * without spending gate budget when every episode is already adjudicated.
   */
  async hasUnadjudicatedEpisodes(): Promise<boolean> {
    const input = await this.prepareDreamInput({} as DreamJob);
    return input.episodes.length > 0;
  }

  async runDreamJob(
    job: DreamJob,
    providerContext: { providerId: ProviderId; model?: string | null },
  ): Promise<DreamRunOutput> {
    const input = await this.prepareDreamInput(job);
    if (input.episodes.length === 0) {
      return { ran: false, reason: 'no_new_episodes', proposals: [] };
    }

    const expectedGenRevision = await this.repo.getCurrentGeneration();
    const runner = this.createRunner(providerContext.providerId);
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(
      () => abortController.abort(),
      this.queryTimeoutMs,
    );

    try {
      const userPrompt = this.buildUserPrompt(input);
      const response = await runner.query(
        {
          systemPrompt: DREAM_SYSTEM_PROMPT,
          model: providerContext.model ?? undefined,
          abortController,
        },
        userPrompt,
      );

      const parsed = this.parseResponse(response);
      const sanitizedProposals = this.sanitizeProposals(parsed.proposals, input.episodes);

      const commitResult = await this.repo.commitDream({
        jobId: job.id,
        proposals: sanitizedProposals,
        adjudicatedEvents: {
          fromEventId: input.fromEventId,
          toEventId: input.toEventId,
          eventCount: input.episodes.length,
        },
        expectedGenRevision,
      });

      return {
        ran: true,
        appliedCount: commitResult.appliedCount,
        rejectedCount: commitResult.rejectedCount,
        proposals: sanitizedProposals,
        keywordAnnotations: parsed.keywordAnnotations,
      };
    } catch (err) {
      return {
        ran: false,
        reason: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      window.clearTimeout(timeoutId);
      runner.reset();
    }
  }

  private buildUserPrompt(input: PreparedDreamInput): string {
    const memoryLines = input.existingMemories.map((m) => {
      const keywordState = m.keywords && m.keywords.length > 0 ? '' : ' (no keywords)';
      return `- id=${m.id} [${m.kind}] [${m.claimKey}]${keywordState} ${m.content}`;
    });
    const episodeLines = input.episodes.map((e) => {
      const toolInfo = e.toolCalls && e.toolCalls.length > 0
        ? `\nTools: ${JSON.stringify(e.toolCalls)}`
        : '';
      return `Episode ${e.id} [${e.role}]:\n${e.content}${toolInfo}`;
    });

    return [
      '### Existing Active Memories (reuse their claimKey when updating the same fact)',
      memoryLines.length > 0 ? memoryLines.join('\n') : '(None)',
      '',
      '### New Episodes to Analyze',
      episodeLines.join('\n\n---\n\n'),
    ].join('\n');
  }

  private parseResponse(response: string): {
    proposals: DreamProposal[];
    keywordAnnotations: KeywordAnnotation[];
  } {
    const empty = { proposals: [] as DreamProposal[], keywordAnnotations: [] as KeywordAnnotation[] };
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return empty;
      const data = JSON.parse(jsonMatch[0]) as {
        proposals?: DreamProposal[];
        keywordAnnotations?: KeywordAnnotation[];
      };
      return {
        proposals: Array.isArray(data.proposals) ? data.proposals : [],
        keywordAnnotations: Array.isArray(data.keywordAnnotations) ? data.keywordAnnotations : [],
      };
    } catch {
      return empty;
    }
  }

  private sanitizeProposals(
    proposals: DreamProposal[],
    episodes: EpisodeRecord[],
  ): DreamProposal[] {
    if (proposals.length === 0) {
      return [
        {
          action: 'no_op',
          kind: 'profile',
          claimKey: 'noop',
          content: '',
          scope: { vaultId: this.vaultId },
          evidence: [],
        },
      ];
    }

    const sanitized: DreamProposal[] = [];
    const episodeMap = new Map(episodes.map((e) => [e.id, e]));

    for (const prop of proposals) {
      if (prop.action === 'no_op') {
        sanitized.push(prop);
        continue;
      }

      // Deduplicate evidence by rootEventId
      const uniqueEvidence = [];
      const seenEventIds = new Set<string>();
      for (const ev of prop.evidence ?? []) {
        if (!seenEventIds.has(ev.rootEventId)) {
          seenEventIds.add(ev.rootEventId);
          uniqueEvidence.push(ev);
        }
      }
      prop.evidence = uniqueEvidence;

      // Section 7 Rule: Assistant saying "it's fixed" is not proof of success
      if (prop.kind === 'lesson' && prop.outcome === 'succeeded') {
        const hasVerifiedProof = uniqueEvidence.some((ev) => {
          if (ev.sourceClass === 'tool_result' || ev.sourceClass === 'user') {
            return true;
          }
          const ep = episodeMap.get(ev.rootEventId);
          if (ep && (ep.role === 'tool_result' || ep.role === 'user')) {
            return true;
          }
          if (ep && ep.toolCalls && ep.toolCalls.some((t) => t.status === 'completed' || t.result)) {
            return true;
          }
          return false;
        });

        if (!hasVerifiedProof) {
          prop.outcome = 'unknown';
        }
      }

      prop.scope = prop.scope ?? { vaultId: this.vaultId };
      prop.claimKey = resolveClaimKey(prop.claimKey, prop.kind, prop.content);
      prop.keywords = sanitizeKeywords(prop.keywords);
      sanitized.push(prop);
    }

    return sanitized;
  }
}
