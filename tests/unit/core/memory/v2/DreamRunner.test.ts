import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { DreamRunner } from '@/core/memory/v2/DreamRunner';
import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';
import type { DreamJob, EpisodeRecord } from '@/core/memory/v2/types';

describe('DreamRunner V2', () => {
  let adapter: InMemoryMemoryStorageAdapter;
  let repo: MemoryRepository;
  let runner: DreamRunner;
  let mockAuxRunner: jest.Mocked<AuxQueryRunner>;
  const vaultId = 'test-vault-123';

  beforeEach(async () => {
    adapter = new InMemoryMemoryStorageAdapter();
    repo = new MemoryRepository({ storage: adapter, vaultId });
    await repo.initialize();

    mockAuxRunner = {
      query: jest.fn(),
      reset: jest.fn(),
    } as unknown as jest.Mocked<AuxQueryRunner>;

    runner = new DreamRunner({
      repository: repo,
      vaultId,
      createRunner: () => mockAuxRunner,
      maxInputChars: 4000,
    });
  });

  it('skips dream when there are no unadjudicated episodes', async () => {
    const job: DreamJob = {
      id: 'job-empty',
      reason: 'scheduled',
      status: 'queued',
      stage: 1,
      attempt: 0,
      nextEligibleAt: Date.now(),
      inputEventRange: { eventCount: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = await runner.runDreamJob(job, { providerId: 'codex' });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('no_new_episodes');
    expect(mockAuxRunner.query).not.toHaveBeenCalled();
  });

  it('bounds episode batches strictly at episode boundaries without partial truncation', async () => {
    // Add 3 episodes
    for (let i = 1; i <= 3; i++) {
      const episode: EpisodeRecord = {
        id: `evt-${i}`,
        revision: '1',
        providerId: 'codex',
        conversationId: 'c-1',
        messageId: `m-${i}`,
        timestamp: 1000 + i,
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `Episode content string number ${i} `.repeat(50), // ~1500 chars each
        scope: { vaultId },
      };
      await repo.appendEpisode(episode);
    }

    const job: DreamJob = {
      id: 'job-boundary',
      reason: 'turn_completion',
      status: 'queued',
      stage: 1,
      attempt: 0,
      nextEligibleAt: Date.now(),
      inputEventRange: { eventCount: 3 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // maxInputChars is 4000. Each episode is ~1500 chars.
    // Only 2 episodes should fit. Episode 3 must NOT be partially truncated or acknowledged!
    const prepared = await runner.prepareDreamInput(job);
    expect(prepared.episodes).toHaveLength(2);
    expect(prepared.episodes[0].id).toBe('evt-1');
    expect(prepared.episodes[1].id).toBe('evt-2');
    expect(prepared.toEventId).toBe('evt-2');
  });

  it('validates proposals: assistant self-assertion does not count as test success', async () => {
    const episode: EpisodeRecord = {
      id: 'evt-test-1',
      revision: '1',
      providerId: 'codex',
      conversationId: 'c-1',
      messageId: 'm-1',
      timestamp: 1000,
      role: 'assistant',
      content: 'I have fixed the memory leak bug!', // Assistant self-claim, no tool result!
      scope: { vaultId },
    };
    await repo.appendEpisode(episode);

    // Mock model output claiming outcome: succeeded
    mockAuxRunner.query.mockResolvedValueOnce(
      JSON.stringify({
        proposals: [
          {
            action: 'add',
            kind: 'lesson',
            claimKey: 'fix.memory_leak',
            content: 'Cleared interval timers on unmount',
            basis: 'observed',
            outcome: 'succeeded', // Model claims succeeded!
            evidence: [
              {
                rootEventId: 'evt-test-1',
                eventRevision: '1',
                providerId: 'codex',
                conversationId: 'c-1',
                messageId: 'm-1',
                span: { start: 0, end: 30 },
                sourceClass: 'assistant', // Sourced only from assistant!
              },
            ],
          },
        ],
      }),
    );

    const job: DreamJob = {
      id: 'job-evidence',
      reason: 'turn_completion',
      status: 'queued',
      stage: 1,
      attempt: 0,
      nextEligibleAt: Date.now(),
      inputEventRange: { eventCount: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = await runner.runDreamJob(job, { providerId: 'codex' });
    expect(result.ran).toBe(true);

    const records = await repo.listRecords({ status: 'active' });
    expect(records).toHaveLength(1);
    // Because evidence sourceClass was assistant only with no tool result or user confirmation,
    // outcome must be demoted to 'unknown'
    expect(records[0].outcome).toBe('unknown');
  });

  it('emits no_op when model finds no new facts and advances checkpoints safely', async () => {
    const episode: EpisodeRecord = {
      id: 'evt-noop-1',
      revision: '1',
      providerId: 'codex',
      conversationId: 'c-1',
      messageId: 'm-1',
      timestamp: 1000,
      role: 'user',
      content: 'Hello, what time is it?',
      scope: { vaultId },
    };
    await repo.appendEpisode(episode);

    mockAuxRunner.query.mockResolvedValueOnce(
      JSON.stringify({
        proposals: [], // No new facts
      }),
    );

    const job: DreamJob = {
      id: 'job-noop',
      reason: 'turn_completion',
      status: 'queued',
      stage: 1,
      attempt: 0,
      nextEligibleAt: Date.now(),
      inputEventRange: { eventCount: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = await runner.runDreamJob(job, { providerId: 'codex' });
    expect(result.ran).toBe(true);

    const records = await repo.listRecords({ status: 'active' });
    expect(records).toHaveLength(0); // Nothing added

    // But checkpoints advanced so this episode won't be reprocessed endlessly
    const checkpoints = await repo.getCheckpoints();
    expect(checkpoints.lastAdjudicatedEventId).toBe('evt-noop-1');
  });
});
