import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';
import type { MemoryRecord } from '@/core/memory/v2/types';

describe('MemoryRepository maintenance', () => {
  let repo: MemoryRepository;
  const vaultId = 'test-vault';
  const DAY = 24 * 60 * 60 * 1000;

  async function seedRecord(overrides: Partial<MemoryRecord>): Promise<MemoryRecord> {
    const result = await repo.commitExplicit({
      action: 'remember',
      kind: 'profile',
      claimKey: overrides.claimKey ?? `pref_${Math.random().toString(36).slice(2, 8)}`,
      content: overrides.content ?? 'content',
      scope: { vaultId },
    });
    const record = (await repo.listRecords({ status: 'active' })).find(
      (r) => r.claimKey === (overrides.claimKey ?? result.claimKey),
    )!;
    if (overrides.reviewAfter !== undefined || overrides.observedAt !== undefined) {
      // The in-memory cache is the source of truth for these tests; mutate via
      // a fresh generation snapshot through commitExplicit is not available,
      // so patch the cached record through the public retention path instead.
      Object.assign(record, {
        reviewAfter: overrides.reviewAfter,
        observedAt: overrides.observedAt ?? record.observedAt,
      });
    }
    return record;
  }

  beforeEach(async () => {
    repo = new MemoryRepository({ storage: new InMemoryMemoryStorageAdapter(), vaultId });
    await repo.initialize();
  });

  describe('applyRetention', () => {
    it('archives active records whose reviewAfter has passed', async () => {
      const now = Date.now();
      const stale = await seedRecord({ claimKey: 'pref.stale' });
      Object.assign(stale, { reviewAfter: now - 1000 });
      const fresh = await seedRecord({ claimKey: 'pref.fresh' });

      const result = await repo.applyRetention({ now });

      expect(result.archivedByReviewAfter).toBe(1);
      expect(stale.status).toBe('archived');
      expect(fresh.status).toBe('active');
    });

    it('flags long-unreferenced records for review only after enough exposures', async () => {
      const now = Date.now();
      const oldObserved = now - 60 * DAY;
      const exposed = await seedRecord({ claimKey: 'pref.exposed', observedAt: oldObserved });
      const barelyExposed = await seedRecord({ claimKey: 'pref.barely', observedAt: oldObserved });

      for (let i = 0; i < 5; i++) {
        await repo.recordFeedback({
          id: `fb_${now + i}_x`,
          memoryId: exposed.id,
          memoryRevision: 1,
          turnId: 'turn',
          type: 'exposed',
          timestamp: now,
        });
        await repo.recordFeedback({
          id: `fb_b${now + i}_x`,
          memoryId: barelyExposed.id,
          memoryRevision: 1,
          turnId: 'turn',
          type: 'exposed',
          timestamp: now,
        });
      }
      // referenced memories never go stale
      await repo.recordFeedback({
        id: `fb_ref_x`,
        memoryId: barelyExposed.id,
        memoryRevision: 1,
        turnId: 'turn',
        type: 'referenced',
        timestamp: now,
      });

      const result = await repo.applyRetention({ now, staleDays: 45, staleMinExposures: 5 });

      expect(result.flaggedStale).toBe(1);
      expect(exposed.reviewAfter).toBe(now);
      expect(barelyExposed.reviewAfter).toBeUndefined();
    });
  });

  describe('pruneStorage', () => {
    it('prunes old episodes but keeps the checkpoint episode', async () => {
      const now = Date.now();
      await repo.appendEpisode({
        id: 'evt_old',
        revision: '1',
        providerId: 'codex',
        conversationId: 'c',
        messageId: 'm',
        timestamp: now - 120 * DAY,
        role: 'user',
        content: 'old',
        scope: { vaultId },
      });
      await repo.appendEpisode({
        id: 'evt_kept',
        revision: '1',
        providerId: 'codex',
        conversationId: 'c',
        messageId: 'm',
        timestamp: now - 100 * DAY,
        role: 'user',
        content: 'checkpoint',
        scope: { vaultId },
      });
      // advance the checkpoint to evt_kept via a dream commit
      await repo.commitDream({
        jobId: 'job_x',
        proposals: [],
        adjudicatedEvents: { fromEventId: 'evt_kept', toEventId: 'evt_kept', eventCount: 1 },
        expectedGenRevision: await repo.getCurrentGeneration(),
      });

      const result = await repo.pruneStorage({ now, episodeRetentionDays: 90 });

      expect(result.prunedEpisodes).toBe(1);
      const episodes = await repo.listEpisodes();
      expect(episodes.map((e) => e.id)).toEqual(['evt_kept']);
    });

    it('removes old generation snapshots but keeps the newest ones and CURRENT', async () => {
      const now = Date.now();
      for (let i = 0; i < 6; i++) {
        await repo.enqueueJob({
          id: `job_${i}`,
          reason: 'turn_completion',
          status: 'succeeded',
          stage: 1,
          attempt: 0,
          nextEligibleAt: now,
          inputEventRange: { eventCount: 0 },
          createdAt: now,
          updatedAt: now,
        });
      }

      const result = await repo.pruneStorage({ now, keepGenerations: 3 });

      expect(result.removedGenerations).toBeGreaterThanOrEqual(3);
      const current = await repo.getCurrentGeneration();
      const adapterFiles = await (repo as unknown as {
        storage: InMemoryMemoryStorageAdapter;
      }).storage.listFiles(`vaults/${vaultId}/generations`);
      const generations = adapterFiles.filter((f) => /^gen_\d+$/.test(f)).sort();
      expect(generations.length).toBeLessThanOrEqual(3);
      expect(generations.at(-1)).toBe(current.replace('gen_', 'gen_'));
      // the current generation still loads
      await repo.initialize();
      expect(await repo.listRecords()).toBeDefined();
    });

    it('prunes feedback files past the retention window', async () => {
      const now = Date.now();
      await repo.recordFeedback({
        id: `fb_${now - 200 * DAY}_old`,
        memoryId: 'mem_x',
        memoryRevision: 1,
        turnId: 't',
        type: 'exposed',
        timestamp: now - 200 * DAY,
      });
      await repo.recordFeedback({
        id: `fb_${now}_new`,
        memoryId: 'mem_x',
        memoryRevision: 1,
        turnId: 't',
        type: 'exposed',
        timestamp: now,
      });

      const result = await repo.pruneStorage({ now, feedbackRetentionDays: 90 });

      expect(result.prunedFeedback).toBe(1);
      // The in-memory summary keeps the session aggregate; a reload over the
      // same storage reflects only the surviving feedback file.
      const reloaded = new MemoryRepository({
        storage: (repo as unknown as { storage: InMemoryMemoryStorageAdapter }).storage,
        vaultId,
      });
      await reloaded.initialize();
      expect(reloaded.getFeedbackSummary().get('mem_x')?.exposed).toBe(1);
    });
  });

  describe('candidates', () => {
    it('commits candidates, deduplicates by claimKey, and approves them', async () => {
      const first = await repo.commitCandidate({
        kind: 'lesson',
        claimKey: 'lesson.pnpm',
        content: 'Use pnpm only',
        scope: { vaultId },
      });
      expect(first?.status).toBe('candidate');

      const duplicate = await repo.commitCandidate({
        kind: 'lesson',
        claimKey: 'lesson.pnpm',
        content: 'Use pnpm only',
        scope: { vaultId },
      });
      expect(duplicate).toBeNull();

      const approved = await repo.approveCandidate(first!.id);
      expect(approved?.status).toBe('active');
    });

    it('dismiss suppresses the claimKey so it is not re-proposed', async () => {
      const candidate = await repo.commitCandidate({
        kind: 'profile',
        claimKey: 'user.no_tabs',
        content: 'Dislikes tab indentation',
        scope: { vaultId },
      });

      const dismissed = await repo.dismissCandidate(candidate!.id);
      expect(dismissed?.status).toBe('archived');
      expect(repo.isSuppressed({ claimKey: 'user.no_tabs' })).toBe(true);

      const reProposal = await repo.commitCandidate({
        kind: 'profile',
        claimKey: 'user.no_tabs',
        content: 'Dislikes tab indentation',
        scope: { vaultId },
      });
      expect(reProposal).toBeNull(); // forget-ledger suppression blocks re-proposals
    });
  });

  describe('keyword annotations', () => {
    it('backfills keywords only for records that lack them', async () => {
      const without = await repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey: 'user.a',
        content: 'A',
        scope: { vaultId },
      });
      const withKeywords = await repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey: 'user.b',
        content: 'B',
        scope: { vaultId },
      });
      Object.assign(withKeywords, { keywords: ['existing'] });

      const applied = await repo.applyKeywordAnnotations([
        { id: without.id, keywords: ['pnpm', 'build'] },
        { id: withKeywords.id, keywords: ['should-be-ignored'] },
        { id: 'mem_missing', keywords: ['x'] },
      ]);

      expect(applied).toBe(1);
      expect(without.keywords).toEqual(['pnpm', 'build']);
      expect(withKeywords.keywords).toEqual(['existing']);
    });
  });

  describe('feedback summary aggregation', () => {
    it('aggregates counts in memory and persists them across initialize', async () => {
      const record = await repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey: 'user.fb',
        content: 'feedback target',
        scope: { vaultId },
      });
      const now = Date.now();
      await repo.recordFeedbackBatch([
        { id: `fb_${now}_1`, memoryId: record.id, memoryRevision: 1, turnId: 't1', type: 'exposed', timestamp: now },
        { id: `fb_${now}_2`, memoryId: record.id, memoryRevision: 1, turnId: 't1', type: 'exposed', timestamp: now },
        { id: `fb_${now}_3`, memoryId: record.id, memoryRevision: 1, turnId: 't1', type: 'referenced', timestamp: now },
      ]);

      const summary = repo.getFeedbackSummary().get(record.id);
      expect(summary).toMatchObject({ exposed: 2, referenced: 1 });

      // A fresh repository over the same storage reloads the aggregate.
      const reloaded = new MemoryRepository({
        storage: (repo as unknown as { storage: InMemoryMemoryStorageAdapter }).storage,
        vaultId,
      });
      await reloaded.initialize();
      expect(reloaded.getFeedbackSummary().get(record.id)).toMatchObject({ exposed: 2, referenced: 1 });
    });
  });
});
