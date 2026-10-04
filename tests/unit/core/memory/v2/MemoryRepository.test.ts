import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';
import type { EpisodeRecord } from '@/core/memory/v2/types';

describe('MemoryRepository V2', () => {
  let adapter: InMemoryMemoryStorageAdapter;
  let repo: MemoryRepository;
  const vaultId = 'test-vault-123';

  beforeEach(async () => {
    adapter = new InMemoryMemoryStorageAdapter();
    repo = new MemoryRepository({
      storage: adapter,
      vaultId,
    });
    await repo.initialize();
  });

  describe('Initialization & Generation Management', () => {
    it('creates gen_000001 and CURRENT pointer on initial setup', async () => {
      const current = await repo.getCurrentGeneration();
      expect(current).toBe('gen_000001');

      const records = await repo.listRecords();
      expect(records).toEqual([]);

      const jobs = await repo.listJobs();
      expect(jobs).toEqual([]);
    });

    it('loads existing generation on re-initialization', async () => {
      await repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey: 'user.language',
        content: 'Use Chinese for explanations',
        scope: { vaultId },
      });

      const genAfterCommit = await repo.getCurrentGeneration();
      expect(genAfterCommit).toBe('gen_000002');

      // Create new repo instance with same storage
      const repo2 = new MemoryRepository({
        storage: adapter,
        vaultId,
      });
      await repo2.initialize();

      expect(await repo2.getCurrentGeneration()).toBe('gen_000002');
      const records = await repo2.listRecords();
      expect(records).toHaveLength(1);
      expect(records[0].claimKey).toBe('user.language');
      expect(records[0].content).toBe('Use Chinese for explanations');
    });
  });

  describe('Explicit User Actions (Remember, Correct, Forget)', () => {
    it('commits explicit remember and creates an active memory record', async () => {
      const record = await repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey: 'user.comment_style',
        content: 'Code comments should be in English',
        scope: { vaultId },
      });

      expect(record.id).toBeDefined();
      expect(record.revision).toBe(1);
      expect(record.status).toBe('active');
      expect(record.basis).toBe('explicit');

      const active = await repo.listRecords({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].content).toBe('Code comments should be in English');
    });

    it('commits explicit correct by superseding the previous record', async () => {
      const initial = await repo.commitExplicit({
        action: 'remember',
        kind: 'project_state',
        claimKey: 'project.package_manager',
        content: 'Project uses npm',
        scope: { vaultId, projectId: 'proj-1' },
      });

      const corrected = await repo.commitExplicit({
        action: 'correct',
        kind: 'project_state',
        claimKey: 'project.package_manager',
        content: 'Project uses pnpm',
        targetId: initial.id,
        scope: { vaultId, projectId: 'proj-1' },
      });

      expect(corrected.revision).toBe(2);
      expect(corrected.supersedes).toContain(initial.id);
      expect(corrected.content).toBe('Project uses pnpm');

      const all = await repo.listRecords();
      const oldRec = all.find((r) => r.id === initial.id);
      expect(oldRec?.status).toBe('superseded');

      const active = await repo.listRecords({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].content).toBe('Project uses pnpm');
    });

    it('commits explicit forget, archives matching records, and records in forget ledger', async () => {
      await repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey: 'user.theme',
        content: 'User prefers light theme',
        scope: { vaultId },
      });

      const forgetResult = await repo.commitExplicit({
        action: 'forget',
        claimKey: 'user.theme',
        reason: 'User preference changed or explicitly cleared',
        scope: { vaultId },
      });

      expect(forgetResult.suppressedCount).toBe(1);

      // Active records should no longer include the forgotten item
      const active = await repo.listRecords({ status: 'active' });
      expect(active).toHaveLength(0);

      // Forget ledger should contain entry
      const ledger = await repo.getForgetLedger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0].claimKey).toBe('user.theme');

      // Subsequent check should identify it as suppressed
      expect(repo.isSuppressed({ claimKey: 'user.theme', content: 'User prefers light theme' })).toBe(true);
    });
  });

  describe('Episode Persistence', () => {
    it('appends and retrieves immutable episodes', async () => {
      const episode: EpisodeRecord = {
        id: 'evt-001',
        revision: 'rev-1',
        providerId: 'codex',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        timestamp: Date.now(),
        role: 'user',
        content: 'Let us build a unified memory system',
        scope: { vaultId, projectId: 'p1' },
      };

      await repo.appendEpisode(episode);

      const retrieved = await repo.getEpisode('evt-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('Let us build a unified memory system');

      const episodes = await repo.listEpisodes();
      expect(episodes).toHaveLength(1);
      expect(episodes[0].id).toBe('evt-001');
    });

    it('idempotently handles duplicate episode appends', async () => {
      const episode: EpisodeRecord = {
        id: 'evt-002',
        revision: 'rev-1',
        providerId: 'codex',
        conversationId: 'conv-1',
        messageId: 'msg-2',
        timestamp: Date.now(),
        role: 'assistant',
        content: 'Agreed, here is the plan.',
        scope: { vaultId },
      };

      await repo.appendEpisode(episode);
      await repo.appendEpisode(episode); // Duplicate append

      const episodes = await repo.listEpisodes();
      expect(episodes).toHaveLength(1);
    });
  });

  describe('Dream Proposals Commit & Checkpoints', () => {
    it('applies dream proposals, advances checkpoints, and advances generation', async () => {
      await repo.appendEpisode({
        id: 'evt-100',
        revision: '1',
        providerId: 'codex',
        conversationId: 'conv-1',
        messageId: 'm-1',
        timestamp: 1000,
        role: 'user',
        content: 'We tested the retry fix with npm test and it passed.',
        scope: { vaultId },
      });

      const currentGen = await repo.getCurrentGeneration();

      const result = await repo.commitDream({
        jobId: 'job-1',
        proposals: [
          {
            action: 'add',
            kind: 'lesson',
            claimKey: 'fix.retry_backoff',
            content: 'Exponential backoff fixed 429 errors',
            scope: { vaultId },
            basis: 'observed',
            evidence: [
              {
                rootEventId: 'evt-100',
                eventRevision: '1',
                providerId: 'codex',
                conversationId: 'conv-1',
                messageId: 'm-1',
                span: { start: 0, end: 50 },
                sourceClass: 'user',
              },
            ],
            outcome: 'succeeded',
          },
        ],
        adjudicatedEvents: {
          fromEventId: 'evt-100',
          toEventId: 'evt-100',
          eventCount: 1,
        },
        expectedGenRevision: currentGen,
      });

      expect(result.appliedCount).toBe(1);
      const newGen = await repo.getCurrentGeneration();
      expect(newGen).not.toBe(currentGen);

      const records = await repo.listRecords({ status: 'active' });
      expect(records).toHaveLength(1);
      expect(records[0].claimKey).toBe('fix.retry_backoff');
      expect(records[0].outcome).toBe('succeeded');

      const checkpoints = await repo.getCheckpoints();
      expect(checkpoints.lastAdjudicatedEventId).toBe('evt-100');
      expect(checkpoints.adjudicatedEventCount).toBe(1);
    });

    it('rejects proposals that violate forget ledger', async () => {
      // User forgets something
      await repo.commitExplicit({
        action: 'forget',
        claimKey: 'secret.token',
        reason: 'Do not remember secret tokens',
        scope: { vaultId },
      });

      const currentGen = await repo.getCurrentGeneration();

      // Dream tries to re-add it
      const result = await repo.commitDream({
        jobId: 'job-2',
        proposals: [
          {
            action: 'add',
            kind: 'profile',
            claimKey: 'secret.token',
            content: 'Token is abc-123',
            scope: { vaultId },
            evidence: [],
          },
          {
            action: 'add',
            kind: 'lesson',
            claimKey: 'lesson.clean_code',
            content: 'Keep functions small',
            scope: { vaultId },
            evidence: [],
          },
        ],
        adjudicatedEvents: { eventCount: 2 },
        expectedGenRevision: currentGen,
      });

      // secret.token must be rejected, lesson.clean_code accepted
      expect(result.appliedCount).toBe(1);
      const active = await repo.listRecords({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].claimKey).toBe('lesson.clean_code');
    });
  });

  describe('Writer Lock & Fencing', () => {
    it('prevents concurrent write operations when locked', async () => {
      const lockToken = await adapter.acquireLock(`vaults/${vaultId}/writer`);
      expect(lockToken).not.toBeNull();

      // Attempting to acquire lock with another repo or call should fail
      const secondLock = await adapter.acquireLock(`vaults/${vaultId}/writer`);
      expect(secondLock).toBeNull();

      if (lockToken) {
        await adapter.releaseLock(`vaults/${vaultId}/writer`, lockToken);
      }
    });
  });
});
