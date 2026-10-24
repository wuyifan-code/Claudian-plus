import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { canonicalClaimKey } from '@/core/memory/v2/claimKey';
import { DreamRunner } from '@/core/memory/v2/DreamRunner';
import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';
import type { DreamJob, EpisodeRecord } from '@/core/memory/v2/types';

describe('DreamRunner keyword index and claimKey stability', () => {
  let repo: MemoryRepository;
  let runner: DreamRunner;
  let mockAuxRunner: jest.Mocked<AuxQueryRunner>;
  const vaultId = 'test-vault';

  const job: DreamJob = {
    id: 'job_kw',
    reason: 'turn_completion',
    status: 'queued',
    stage: 1,
    attempt: 0,
    nextEligibleAt: 0,
    inputEventRange: { eventCount: 1 },
    createdAt: 0,
    updatedAt: 0,
  };

  async function seedEpisode(): Promise<EpisodeRecord> {
    const episode: EpisodeRecord = {
      id: 'evt_kw_1',
      revision: '1',
      providerId: 'codex',
      conversationId: 'conv',
      messageId: 'msg',
      timestamp: Date.now(),
      role: 'user',
      content: 'User: use pnpm for builds\nAssistant: noted',
      scope: { vaultId },
    };
    await repo.appendEpisode(episode);
    return episode;
  }

  beforeEach(async () => {
    repo = new MemoryRepository({ storage: new InMemoryMemoryStorageAdapter(), vaultId });
    await repo.initialize();
    mockAuxRunner = {
      query: jest.fn(),
      reset: jest.fn(),
    } as unknown as jest.Mocked<AuxQueryRunner>;
    runner = new DreamRunner({ repository: repo, vaultId, createRunner: () => mockAuxRunner });
  });

  it('asks the model for keywords and marks keywordless existing memories', async () => {
    await repo.commitExplicit({
      action: 'remember',
      kind: 'profile',
      claimKey: 'user.existing',
      content: '已有记忆',
      scope: { vaultId },
    });
    await seedEpisode();
    mockAuxRunner.query.mockResolvedValueOnce(JSON.stringify({ proposals: [] }));

    await runner.runDreamJob(job, { providerId: 'codex' });

    const systemPrompt = mockAuxRunner.query.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('"keywords"');
    expect(systemPrompt).toContain('keywordAnnotations');
    expect(systemPrompt).toContain('REUSE that record\'s claimKey');

    const userPrompt = mockAuxRunner.query.mock.calls[0][1] as string;
    expect(userPrompt).toContain('(no keywords)');
    expect(userPrompt).toContain('id=mem_');
  });

  it('stores proposal keywords and returns keyword annotations for backfill', async () => {
    await seedEpisode();
    const existing = await repo.commitExplicit({
      action: 'remember',
      kind: 'profile',
      claimKey: 'user.existing',
      content: '已有记忆',
      scope: { vaultId },
    });

    mockAuxRunner.query.mockResolvedValueOnce(
      JSON.stringify({
        proposals: [
          {
            action: 'add',
            kind: 'project_state',
            claimKey: 'project.package_manager',
            content: 'Use pnpm for builds',
            basis: 'explicit',
            keywords: ['PNPM', 'pnpm', '构建', ''],
            evidence: [
              {
                rootEventId: 'evt_kw_1',
                eventRevision: '1',
                providerId: 'codex',
                conversationId: 'conv',
                messageId: 'msg',
                span: { start: 0, end: 10 },
                sourceClass: 'user',
              },
            ],
          },
        ],
        keywordAnnotations: [{ id: existing.id, keywords: ['旧记忆', 'existing'] }],
      }),
    );

    const result = await runner.runDreamJob(job, { providerId: 'codex' });

    expect(result.ran).toBe(true);
    const active = await repo.listRecords({ status: 'active' });
    const created = active.find((r) => r.claimKey === 'project.package_manager');
    expect(created?.keywords).toEqual(['pnpm', '构建']);
    expect(result.keywordAnnotations).toEqual([
      { id: existing.id, keywords: ['旧记忆', 'existing'] },
    ]);

    const applied = await repo.applyKeywordAnnotations(result.keywordAnnotations!);
    expect(applied).toBe(1);
  });

  it('falls back to the canonical claimKey when the model emits an invalid key', async () => {
    await seedEpisode();
    mockAuxRunner.query.mockResolvedValueOnce(
      JSON.stringify({
        proposals: [
          {
            action: 'add',
            kind: 'profile',
            claimKey: 'key with spaces',
            content: 'Prefers short answers',
            evidence: [],
          },
        ],
      }),
    );

    await runner.runDreamJob(job, { providerId: 'codex' });

    const active = await repo.listRecords({ status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].claimKey).toBe(canonicalClaimKey('profile', 'Prefers short answers'));
  });
});
