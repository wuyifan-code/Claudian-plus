import type { BackgroundRequestGate } from '@/core/auxiliary/AuxiliaryRequestPolicy';
import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { DreamRunner } from '@/core/memory/v2/DreamRunner';
import { MemoryCoordinator } from '@/core/memory/v2/MemoryCoordinator';
import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';

describe('MemoryCoordinator V2', () => {
  let adapter: InMemoryMemoryStorageAdapter;
  let repo: MemoryRepository;
  let runner: DreamRunner;
  let coordinator: MemoryCoordinator;
  let mockGate: jest.Mocked<BackgroundRequestGate>;
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
    });

    mockGate = {
      allowsAutomaticTask: jest.fn().mockReturnValue(true),
      tryBegin: jest.fn().mockReturnValue(null),
      end: jest.fn(),
    } as unknown as jest.Mocked<BackgroundRequestGate>;

    coordinator = new MemoryCoordinator({
      repository: repo,
      dreamRunner: runner,
      backgroundRequestGate: mockGate,
      vaultId,
      getConversationContext: () => ({ providerId: 'codex', model: null }),
    });
  });

  describe('Turn Event Ingestion', () => {
    it('records turn completed, persists immutable episode, and enqueues dream job', async () => {
      await coordinator.recordTurnCompleted({
        providerId: 'codex',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        userContent: 'Please explain in Chinese and keep comments in English',
        assistantContent: '好的，后续会遵循这个要求。',
        scope: { vaultId },
      });

      const episodes = await repo.listEpisodes();
      expect(episodes).toHaveLength(1);
      expect(episodes[0].content).toContain('keep comments in English');

      const jobs = await repo.listJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe('queued');
      expect(jobs[0].reason).toBe('turn_completion');
    });
  });

  describe('Gate & Economy Enforcement', () => {
    it('defers automatic dream job when gate disallows (e.g. economy mode)', async () => {
      mockGate.allowsAutomaticTask.mockReturnValue(false); // e.g. saving mode

      await coordinator.recordTurnCompleted({
        providerId: 'codex',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        userContent: 'Just a normal chat',
        assistantContent: 'Sure!',
        scope: { vaultId },
      });

      const result = await coordinator.processPendingJobs();
      expect(result.processed).toBe(0);

      const jobs = await repo.listJobs();
      expect(jobs[0].status).toBe('deferred');
      expect(jobs[0].deferredReason).toBe('saving-mode');
      expect(mockAuxRunner.query).not.toHaveBeenCalled();
    });

    it('defers job when daily request budget is exceeded', async () => {
      mockGate.allowsAutomaticTask.mockReturnValue(true);
      mockGate.tryBegin.mockReturnValue('daily-limit-reached');

      await coordinator.recordTurnCompleted({
        providerId: 'codex',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        userContent: 'Just a normal chat',
        assistantContent: 'Sure!',
        scope: { vaultId },
      });

      const result = await coordinator.processPendingJobs();
      expect(result.processed).toBe(0);

      const jobs = await repo.listJobs();
      expect(jobs[0].status).toBe('deferred');
      expect(jobs[0].deferredReason).toBe('daily-limit');
      expect(mockAuxRunner.query).not.toHaveBeenCalled();
    });
  });

  describe('Explicit Fast-Path Commands', () => {
    it('immediately commits explicit remember without waiting for dream', async () => {
      const handled = await coordinator.handleExplicitCommand(
        '记住：以后代码注释全部用英文',
        { vaultId },
      );

      expect(handled).toBe(true);
      const records = await repo.listRecords({ status: 'active' });
      expect(records).toHaveLength(1);
      expect(records[0].content).toContain('代码注释全部用英文');
      expect(records[0].basis).toBe('explicit');
    });

    it('immediately commits explicit forget without waiting for dream', async () => {
      await coordinator.handleExplicitCommand('记住：代码注释用英文', { vaultId });
      const handled = await coordinator.handleExplicitCommand('忘记关于代码注释的偏好', { vaultId });

      expect(handled).toBe(true);
      const active = await repo.listRecords({ status: 'active' });
      expect(active).toHaveLength(0);
    });
  });
});
