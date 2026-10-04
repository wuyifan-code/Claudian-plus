import type { BackgroundRequestGate } from '../../auxiliary/AuxiliaryRequestPolicy';
import type { ProviderId } from '../../providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../../providers/types';
import type { DreamRunner } from './DreamRunner';
import type { MemoryRepository } from './MemoryRepository';
import type {
  DreamJob,
  EpisodeRecord,
  EpisodeToolCall,
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
}

export class MemoryCoordinator {
  private readonly repo: MemoryRepository;
  private readonly dreamRunner: DreamRunner;
  private readonly gate?: BackgroundRequestGate;
  private readonly vaultId: string;
  private readonly getConversationContext?: () => { providerId: ProviderId; model: string | null } | null;
  private readonly isForegroundBusy?: () => boolean;
  private readonly onNotification?: (msg: string) => void;

  private isProcessing = false;

  constructor(options: MemoryCoordinatorOptions) {
    this.repo = options.repository;
    this.dreamRunner = options.dreamRunner;
    this.gate = options.backgroundRequestGate;
    this.vaultId = options.vaultId;
    this.getConversationContext = options.getConversationContext;
    this.isForegroundBusy = options.isForegroundBusy;
    this.onNotification = options.onNotification;
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

      for (const job of pendingJobs) {
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
            if (this.onNotification && result.appliedCount && result.appliedCount > 0) {
              this.onNotification(`Dream consolidated ${result.appliedCount} new fact(s).`);
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

  async handleExplicitCommand(message: string, scope: MemoryScope): Promise<boolean> {
    const trimmed = message.trim();

    // 1. Explicit Remember: "记住：..." / "remember: ..." / "把...记下来"
    const rememberMatch = trimmed.match(/^(?:请?记住[：:\s]*|remember[:\s]+)(.+)/i);
    if (rememberMatch) {
      const content = rememberMatch[1].trim();
      const claimKey = `pref_${this.simpleSlug(content.slice(0, 20))}`;
      await this.repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey,
        content,
        scope,
      });
      return true;
    }

    // 2. Explicit Forget: "忘记关于...的记忆" / "忘记：..." / "forget: ..."
    const forgetMatch = trimmed.match(/^(?:请?忘记(?:关于)?[：:\s]*|forget[:\s]+)(.+)/i);
    if (forgetMatch) {
      let term = forgetMatch[1].trim();
      term = term.replace(/(?:的记忆|的偏好|的信息)$/, '').trim();
      const allRecords = await this.repo.listRecords({ status: 'active' });
      const matched = allRecords.find((r) => r.content.includes(term) || r.claimKey.includes(term));
      const claimKey = matched ? matched.claimKey : `pref_${this.simpleSlug(term)}`;

      await this.repo.commitExplicit({
        action: 'forget',
        claimKey,
        reason: `User asked to forget: ${term}`,
        scope,
      });
      return true;
    }

    // 3. Explicit Correct: "纠正：..." / "correct: ..."
    const correctMatch = trimmed.match(/^(?:纠正[：:\s]*|correct[:\s]+)(.+)/i);
    if (correctMatch) {
      const content = correctMatch[1].trim();
      const claimKey = `claim_${this.simpleSlug(content.slice(0, 20))}`;
      await this.repo.commitExplicit({
        action: 'correct',
        kind: 'project_state',
        claimKey,
        content,
        scope,
      });
      return true;
    }

    return false;
  }

  private simpleSlug(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
      .slice(0, 30)
      .replace(/^_+|_+$/g, '');
  }
}
