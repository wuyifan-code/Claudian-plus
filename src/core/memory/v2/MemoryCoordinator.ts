import type { BackgroundRequestGate } from '../../auxiliary/AuxiliaryRequestPolicy';
import type { ProviderId } from '../../providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../providers/types';
import { canonicalClaimKey } from './claimKey';
import type { DreamRunner } from './DreamRunner';
import type { MemoryRepository } from './MemoryRepository';
import type {
  DreamJob,
  EpisodeRecord,
  EpisodeToolCall,
  MemoryContextPacket,
  MemoryFeedbackRecord,
  MemoryKind,
  MemoryScope,
} from './types';

export interface TurnCompletedParams {
  providerId: string;
  conversationId: string;
  messageId: string;
  userContent: string;
  assistantContent: string;
  toolCalls?: EpisodeToolCall[];
  scope: MemoryScope & { activeFilePath?: string };
}

export interface MemoryCoordinatorOptions {
  repository: MemoryRepository;
  dreamRunner: DreamRunner;
  backgroundRequestGate?: BackgroundRequestGate;
  vaultId: string;
  getConversationContext?: () => { providerId: ProviderId; model: string | null } | null;
  isForegroundBusy?: () => boolean;
  onNotification?: (msg: string) => void;
  /** Fired (fire-and-forget) after any commit that changed active records. */
  onRecordsChanged?: () => void;
}

export type MemoryCommandResult =
  | { handled: false }
  | { handled: true; action: 'remember' | 'correct'; content: string }
  | { handled: true; action: 'forget'; removedCount: number; unmatched: boolean }
  | { handled: true; action: 'list'; total: number; byKind: Partial<Record<MemoryKind, number>> };

const REMEMBER_ANCHORED = /^(?:请?记住[：:\s]*|记一下[：:\s]*|remember[:\s]+)(.+)/i;
const REMEMBER_PICK_UP = /^把(.{1,80}?)记下来$/;
// Mid-sentence forms require a leading connector or a sentence break so
// narrative uses of "记住" (e.g. "我没让你记住") do not trigger extraction.
const REMEMBER_MID = /(?:顺便|对了|另外|还有|此外|帮我们?|麻烦)[，,]?\s*(?:请)?记住[：:]\s*(.+)|[。！？\n]\s*(?:请)?记住[：:]\s*(.+)|(?:also|and)\s+remember[:：]\s+(.+)/i;
const FORGET_PATTERN = /^(?:请?忘记(?:关于)?[：:\s]*|forget[:\s]+)(.+)/i;
const CORRECT_PATTERN = /^(?:纠正[：:\s]+|correct[:\s]+)(.+)/i;
const LIST_PATTERN = /^(?:列出|查看|显示)(?:我的)?(?:所有)?记忆$|^list (?:my )?memor(?:y|ies)$/i;

export class MemoryCoordinator {
  private readonly repo: MemoryRepository;
  private readonly dreamRunner: DreamRunner;
  private readonly gate?: BackgroundRequestGate;
  private readonly vaultId: string;
  private readonly getConversationContext?: () => { providerId: ProviderId; model: string | null } | null;
  private readonly isForegroundBusy?: () => boolean;
  private readonly onNotification?: (msg: string) => void;
  private readonly onRecordsChanged?: () => void;

  private isProcessing = false;
  private pendingRecallPacket: MemoryContextPacket | null = null;

  constructor(options: MemoryCoordinatorOptions) {
    this.repo = options.repository;
    this.dreamRunner = options.dreamRunner;
    this.gate = options.backgroundRequestGate;
    this.vaultId = options.vaultId;
    this.getConversationContext = options.getConversationContext;
    this.isForegroundBusy = options.isForegroundBusy;
    this.onNotification = options.onNotification;
    this.onRecordsChanged = options.onRecordsChanged;
  }

  /**
   * Hands the most recent retrieval packet to the coordinator so the next
   * completed turn can record exposure/reference feedback for its entries.
   */
  noteRecallPacket(packet: MemoryContextPacket | null): void {
    this.pendingRecallPacket = packet && packet.entries.length > 0 ? packet : null;
  }

  async recordTurnCompleted(params: TurnCompletedParams): Promise<void> {
    const now = Date.now();
    const episodeId = `evt_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const fullContent = `User: ${params.userContent}\nAssistant: ${params.assistantContent}`;

    const episode: EpisodeRecord = {
      id: episodeId,
      revision: '1',
      providerId: params.providerId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      timestamp: now,
      role: 'user', // Root turn episode
      content: fullContent,
      toolCalls: params.toolCalls,
      scope: params.scope,
    };

    await this.repo.appendEpisode(episode);

    // Create background dream job
    const job: DreamJob = {
      id: `job_${now}_${Math.random().toString(36).slice(2, 7)}`,
      reason: 'turn_completion',
      status: 'queued',
      stage: 1,
      attempt: 0,
      nextEligibleAt: now,
      inputEventRange: {
        fromEventId: episodeId,
        toEventId: episodeId,
        eventCount: 1,
      },
      createdAt: now,
      updatedAt: now,
    };

    // Store job in repository
    await this.repo.enqueueJob(job);

    await this.flushRecallFeedback(params.assistantContent, params.messageId);
  }

  /** Records an idle-observation summary as an episode and queues a dream job. */
  async recordIdleObservation(content: string, scope: MemoryScope & { activeFilePath?: string }): Promise<void> {
    const now = Date.now();
    const episodeId = `evt_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const episode: EpisodeRecord = {
      id: episodeId,
      revision: '1',
      providerId: 'ambient',
      conversationId: 'idle-observation',
      messageId: `idle_${now}`,
      timestamp: now,
      role: 'user',
      content: `Idle observation: ${content}`,
      scope,
    };
    await this.repo.appendEpisode(episode);

    await this.repo.enqueueJob({
      id: `job_${now}_${Math.random().toString(36).slice(2, 7)}`,
      reason: 'idle_observation',
      status: 'queued',
      stage: 1,
      attempt: 0,
      nextEligibleAt: now,
      inputEventRange: {
        fromEventId: episodeId,
        toEventId: episodeId,
        eventCount: 1,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Enqueues a scheduled job covering whatever episodes the checkpoint missed. */
  async enqueueScheduledJob(reason: DreamJob['reason'] = 'scheduled'): Promise<void> {
    const now = Date.now();
    await this.repo.enqueueJob({
      id: `job_${now}_${Math.random().toString(36).slice(2, 7)}`,
      reason,
      status: 'queued',
      stage: 1,
      attempt: 0,
      nextEligibleAt: now,
      inputEventRange: { eventCount: 0 },
      createdAt: now,
      updatedAt: now,
    });
  }

  private async flushRecallFeedback(assistantContent: string, turnId: string): Promise<void> {
    const packet = this.pendingRecallPacket;
    this.pendingRecallPacket = null;
    if (!packet) return;

    const records: MemoryFeedbackRecord[] = [];
    packet.entries.forEach((entry, index) => {
      const now = Date.now();
      const id = `fb_${now}_${index}_${Math.random().toString(36).slice(2, 5)}`;
      records.push({
        id,
        memoryId: entry.id,
        memoryRevision: entry.revision,
        turnId,
        type: 'exposed',
        timestamp: now,
        details: packet.traceId,
      });
      const referenced =
        assistantContent.includes(entry.claimKey) || assistantContent.includes(entry.content);
      if (referenced) {
        records.push({
          id: `${id}_ref`,
          memoryId: entry.id,
          memoryRevision: entry.revision,
          turnId,
          type: 'referenced',
          timestamp: now,
          details: packet.traceId,
        });
      }
    });

    if (records.length === 0) return;
    try {
      await this.repo.recordFeedbackBatch(records);
    } catch {
      // Feedback is best-effort and must never disturb the turn flow.
    }
  }

  async processPendingJobs(): Promise<{ processed: number; deferred: number; failed: number }> {
    if (this.isProcessing) {
      return { processed: 0, deferred: 0, failed: 0 };
    }
    if (this.isForegroundBusy && this.isForegroundBusy()) {
      return { processed: 0, deferred: 0, failed: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let deferred = 0;
    let failed = 0;

    try {
      const allJobs = await this.repo.listJobs();
      const now = Date.now();
      const pendingJobs = allJobs.filter(
        (j) => (j.status === 'queued' || j.status === 'deferred') && j.nextEligibleAt <= now,
      );

      // A local-IO pre-check: jobs whose episodes were already adjudicated by
      // an earlier run are closed out without spending any gate budget.
      let hasUnadjudicatedEpisodes: boolean | null = null;

      for (const job of pendingJobs) {
        if (hasUnadjudicatedEpisodes === null) {
          hasUnadjudicatedEpisodes = await this.dreamRunner.hasUnadjudicatedEpisodes();
        }
        if (!hasUnadjudicatedEpisodes) {
          job.status = 'succeeded';
          job.updatedAt = now;
          await this.repo.updateJob(job);
          processed++;
          continue;
        }

        // Gate check 1: Saving mode / automatic task allowed
        if (this.gate && !this.gate.allowsAutomaticTask('auto-dream')) {
          job.status = 'deferred';
          job.deferredReason = 'saving-mode';
          job.updatedAt = now;
          await this.repo.updateJob(job);
          deferred++;
          continue;
        }

        // Gate check 2: Daily request budget
        if (this.gate) {
          const rejection = this.gate.tryBegin();
          if (rejection !== null) {
            job.status = 'deferred';
            job.deferredReason = rejection === 'busy' ? 'busy' : 'daily-limit';
            job.updatedAt = now;
            await this.repo.updateJob(job);
            deferred++;
            continue;
          }
        }

        // Run the dream job
        try {
          const providerCtx = this.getConversationContext?.() ?? {
            providerId: DEFAULT_CHAT_PROVIDER_ID,
            model: null,
          };

          const result = await this.dreamRunner.runDreamJob(job, providerCtx);
          if (result.ran) {
            job.status = 'succeeded';
            job.updatedAt = Date.now();
            await this.repo.updateJob(job);
            processed++;
            if (result.keywordAnnotations && result.keywordAnnotations.length > 0) {
              await this.repo.applyKeywordAnnotations(result.keywordAnnotations).catch(() => undefined);
            }
            if (result.appliedCount && result.appliedCount > 0) {
              this.notifyRecordsChanged();
              if (this.onNotification) {
                this.onNotification(`Dream consolidated ${result.appliedCount} new fact(s).`);
              }
            }
          } else {
            job.status = 'deferred';
            job.updatedAt = Date.now();
            await this.repo.updateJob(job);
            deferred++;
          }
        } catch (err) {
          job.attempt += 1;
          job.updatedAt = Date.now();
          if (job.attempt >= 3) {
            job.status = 'failed';
            job.error = err instanceof Error ? err.message : String(err);
            failed++;
          } else {
            job.status = 'deferred';
            job.nextEligibleAt = Date.now() + Math.pow(2, job.attempt) * 60_000;
            deferred++;
          }
          await this.repo.updateJob(job);
        } finally {
          this.gate?.end();
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return { processed, deferred, failed };
  }

  async handleExplicitCommand(message: string, scope: MemoryScope): Promise<MemoryCommandResult> {
    const trimmed = message.trim();

    // 1. List: "列出记忆" / "list memories"
    if (LIST_PATTERN.test(trimmed)) {
      const active = await this.repo.listRecords({ status: 'active' });
      const byKind: Partial<Record<MemoryKind, number>> = {};
      for (const rec of active) {
        byKind[rec.kind] = (byKind[rec.kind] ?? 0) + 1;
      }
      return { handled: true, action: 'list', total: active.length, byKind };
    }

    // 2. Remember: anchored "记住：..." or mid-sentence "顺便记住..."
    const rememberContent = this.matchRememberCommand(trimmed);
    if (rememberContent) {
      const claimKey = canonicalClaimKey('profile', rememberContent);
      await this.repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey,
        content: rememberContent,
        scope,
      });
      this.notifyRecordsChanged();
      return { handled: true, action: 'remember', content: rememberContent };
    }

    // 3. Forget: "忘记关于...的记忆" — suppresses every match, not just the first
    const forgetMatch = trimmed.match(FORGET_PATTERN);
    if (forgetMatch) {
      let term = forgetMatch[1].trim();
      term = term.replace(/(?:的记忆|的偏好|的信息)$/, '').trim();
      const allRecords = await this.repo.listRecords({ status: 'active' });
      const matched = allRecords.filter(
        (r) => r.content.includes(term) || r.claimKey.includes(term),
      );

      if (matched.length > 0) {
        let suppressed = 0;
        for (const rec of matched) {
          const result = await this.repo.commitExplicit({
            action: 'forget',
            claimKey: rec.claimKey,
            content: rec.content,
            scope,
            reason: `User asked to forget: ${term}`,
          });
          suppressed += result.suppressedCount;
        }
        this.notifyRecordsChanged();
        return { handled: true, action: 'forget', removedCount: suppressed, unmatched: false };
      }

      // No match: still ledger the canonical key so the fact is not re-learned.
      await this.repo.commitExplicit({
        action: 'forget',
        claimKey: canonicalClaimKey('profile', term),
        scope,
        reason: `User asked to forget: ${term}`,
      });
      return { handled: true, action: 'forget', removedCount: 0, unmatched: true };
    }

    // 4. Correct: "纠正：..."
    const correctMatch = trimmed.match(CORRECT_PATTERN);
    if (correctMatch) {
      const content = correctMatch[1].trim();
      const claimKey = canonicalClaimKey('project_state', content);
      await this.repo.commitExplicit({
        action: 'correct',
        kind: 'project_state',
        claimKey,
        content,
        scope,
      });
      this.notifyRecordsChanged();
      return { handled: true, action: 'correct', content };
    }

    return { handled: false };
  }

  private matchRememberCommand(trimmed: string): string | null {
    const anchored = trimmed.match(REMEMBER_ANCHORED);
    if (anchored) {
      return anchored[1].trim();
    }
    const pickUp = trimmed.match(REMEMBER_PICK_UP);
    if (pickUp) {
      return pickUp[1].trim();
    }
    const mid = trimmed.match(REMEMBER_MID);
    const content = mid?.[1] ?? mid?.[2] ?? mid?.[3];
    return content ? content.trim() : null;
  }

  private notifyRecordsChanged(): void {
    if (!this.onRecordsChanged) return;
    try {
      this.onRecordsChanged();
    } catch {
      // Export refresh is best-effort.
    }
  }
}
