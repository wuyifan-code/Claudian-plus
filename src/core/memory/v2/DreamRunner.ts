import type { AuxQueryRunner } from '../../auxiliary/AuxQueryRunner';
import type { ProviderId } from '../../providers/types';
import type { MemoryRepository } from './MemoryRepository';
import type {
  DreamJob,
  DreamProposal,
  EpisodeRecord,
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
}

export interface PreparedDreamInput {
  episodes: EpisodeRecord[];
  existingMemories: MemoryRecord[];
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
  ]
}

CRITICAL RULES:
1. Do not invent facts. Every fact MUST have verifiable evidence from the episodes.
2. An assistant claiming "I fixed it" is NOT proof of success. Outcome is only "succeeded" if confirmed by a tool_result or user statement.
3. If there are no new facts or changes, return "proposals": [].`;

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

    return {
      episodes: selectedEpisodes,
      existingMemories,
      fromEventId: selectedEpisodes[0]?.id,
      toEventId: selectedEpisodes[selectedEpisodes.length - 1]?.id,
      inputLength: currentChars,
    };
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

      const parsedProposals = this.parseResponse(response, input.episodes);
      const sanitizedProposals = this.sanitizeProposals(parsedProposals, input.episodes);

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
    const memoryLines = input.existingMemories.map(
      (m) => `- [${m.kind}] [${m.claimKey}] ${m.content}`,
    );
    const episodeLines = input.episodes.map((e) => {
      const toolInfo = e.toolCalls && e.toolCalls.length > 0
        ? `\nTools: ${JSON.stringify(e.toolCalls)}`
        : '';
      return `Episode ${e.id} [${e.role}]:\n${e.content}${toolInfo}`;
    });

    return [
      '### Existing Active Memories',
      memoryLines.length > 0 ? memoryLines.join('\n') : '(None)',
      '',
      '### New Episodes to Analyze',
      episodeLines.join('\n\n---\n\n'),
    ].join('\n');
  }

  private parseResponse(response: string, episodes: EpisodeRecord[]): DreamProposal[] {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];
      const data = JSON.parse(jsonMatch[0]) as { proposals?: DreamProposal[] };
      return Array.isArray(data.proposals) ? data.proposals : [];
    } catch {
      return [];
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
      sanitized.push(prop);
    }

    return sanitized;
  }
}
