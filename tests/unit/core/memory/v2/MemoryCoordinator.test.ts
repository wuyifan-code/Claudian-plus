import type { BackgroundRequestGate } from '@/core/auxiliary/AuxiliaryRequestPolicy';
import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { canonicalClaimKey } from '@/core/memory/v2/claimKey';
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

    it('closes out queued jobs locally without budget when nothing is unadjudicated', async () => {
      // Adjudicate everything first by running one successful dream job.
      mockAuxRunner.query.mockResolvedValueOnce(JSON.stringify({ proposals: [] }));
      await coordinator.recordTurnCompleted({
        providerId: 'codex',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        userContent: 'hello',
        assistantContent: 'hi',
        scope: { vaultId },
      });
      await coordinator.processPendingJobs();

      // A scheduled job with nothing new must not consume budget.
      await coordinator.enqueueScheduledJob('scheduled');
      const result = await coordinator.processPendingJobs();

      expect(result.processed).toBe(1);
      expect(mockGate.tryBegin).toHaveBeenCalledTimes(1); // only the first dream
      expect(mockAuxRunner.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('Explicit Fast-Path Commands', () => {
    it('immediately commits explicit remember without waiting for dream', async () => {
      const result = await coordinator.handleExplicitCommand(
        '记住：以后代码注释全部用英文',
        { vaultId },
      );

      expect(result.handled).toBe(true);
      const records = await repo.listRecords({ status: 'active' });
      expect(records).toHaveLength(1);
      expect(records[0].content).toContain('代码注释全部用英文');
      expect(records[0].basis).toBe('explicit');
      expect(records[0].claimKey).toBe(canonicalClaimKey('profile', '以后代码注释全部用英文'));
    });

    it('uses a stable claimKey so the same fact remembered twice merges', async () => {
      await coordinator.handleExplicitCommand('记住：喜欢简洁回复', { vaultId });
      await coordinator.handleExplicitCommand('记住：喜欢简洁回复', { vaultId });

      const active = await repo.listRecords({ status: 'active' });
      expect(active).toHaveLength(1);
    });

    it('matches mid-sentence remember commands with connectors', async () => {
      const result = await coordinator.handleExplicitCommand(
        '帮我看下这个报错，顺便记住：构建用 pnpm',
        { vaultId },
      );

      expect(result.handled).toBe(true);
      expect(result).toMatchObject({ action: 'remember', content: '构建用 pnpm' });
    });

    it('does not treat narrative uses of 记住 as commands', async () => {
      const result = await coordinator.handleExplicitCommand(
        '我没有让你记住这句话，别多想',
        { vaultId },
      );

      expect(result.handled).toBe(false);
    });

    it('forgets every matching record, not only the first', async () => {
      await coordinator.handleExplicitCommand('记住：pnpm 构建偏好', { vaultId });
      await coordinator.handleExplicitCommand('记住：pnpm 安装速度更快', { vaultId });

      const result = await coordinator.handleExplicitCommand('忘记关于pnpm的记忆', { vaultId });

      expect(result.handled).toBe(true);
      expect(result).toMatchObject({ action: 'forget', removedCount: 2, unmatched: false });
      expect(await repo.listRecords({ status: 'active' })).toHaveLength(0);
    });

    it('ledgers an unmatched forget so the fact is not re-learned', async () => {
      const result = await coordinator.handleExplicitCommand('forget: dark mode preference', { vaultId });

      expect(result.handled).toBe(true);
      expect(result).toMatchObject({ action: 'forget', unmatched: true });
      expect((await repo.getForgetLedger()).length).toBe(1);
    });

    it('answers list commands with the active record counts', async () => {
      await coordinator.handleExplicitCommand('记住：喜欢简洁回复', { vaultId });
      await coordinator.handleExplicitCommand('纠正：构建工具为 pnpm', { vaultId });

      const result = await coordinator.handleExplicitCommand('列出记忆', { vaultId });

      expect(result.handled).toBe(true);
      expect(result).toMatchObject({
        action: 'list',
        total: 2,
        byKind: { profile: 1, project_state: 1 },
      });
    });
  });

  describe('Recall Feedback Loop', () => {
    it('records exposed feedback for injected entries on the next turn', async () => {
      const remember = await coordinator.handleExplicitCommand('记住：喜欢简洁回复', { vaultId });
      expect(remember.handled).toBe(true);
      const record = (await repo.listRecords({ status: 'active' }))[0];

      coordinator.noteRecallPacket({
        revision: 'gen_000002',
        forgetLedgerRevision: 'fl_0',
        text: '<memory-context>...</memory-context>',
        estimatedTokens: 10,
        traceId: 'trace_1',
        entries: [
          {
            id: record.id,
            revision: record.revision,
            reason: 'keyword_match:1',
            kind: 'profile',
            claimKey: record.claimKey,
            content: record.content,
          },
        ],
      });

      await coordinator.recordTurnCompleted({
        providerId: 'codex',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        userContent: 'next question',
        assistantContent: '好的',
        scope: { vaultId },
      });

      const summary = repo.getFeedbackSummary();
      expect(summary.get(record.id)?.exposed).toBe(1);
      expect(summary.get(record.id)?.referenced).toBe(0);
    });

    it('records referenced feedback when the assistant echoes the memory', async () => {
      const remember = await coordinator.handleExplicitCommand('记住：喜欢简洁回复', { vaultId });
      expect(remember.handled).toBe(true);
      const record = (await repo.listRecords({ status: 'active' }))[0];

      coordinator.noteRecallPacket({
        revision: 'gen_000002',
        forgetLedgerRevision: 'fl_0',
        text: '<memory-context>...</memory-context>',
        estimatedTokens: 10,
        traceId: 'trace_2',
        entries: [
          {
            id: record.id,
            revision: record.revision,
            reason: 'keyword_match:1',
            kind: 'profile',
            claimKey: record.claimKey,
            content: record.content,
          },
        ],
      });

      await coordinator.recordTurnCompleted({
        providerId: 'codex',
        conversationId: 'conv-1',
        messageId: 'msg-2',
        userContent: 'how should you reply?',
        assistantContent: `根据你的偏好（${record.content}），我会简洁回复。`,
        scope: { vaultId },
      });

      const summary = repo.getFeedbackSummary();
      expect(summary.get(record.id)?.referenced).toBe(1);
    });
  });

  describe('Idle Observation', () => {
    it('records an idle observation episode and queues an idle dream job', async () => {
      await coordinator.recordIdleObservation(
        'From 10:00 to 10:20, the user worked on:\n- notes/project.md (edited 3x)',
        { vaultId },
      );

      const episodes = await repo.listEpisodes();
      expect(episodes).toHaveLength(1);
      expect(episodes[0].content).toContain('Idle observation:');
      expect(episodes[0].content).toContain('notes/project.md');

      const jobs = await repo.listJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].reason).toBe('idle_observation');
    });
  });

  describe('Records-changed callback', () => {
    it('fires after explicit commits', async () => {
      const onRecordsChanged = jest.fn();
      const wired = new MemoryCoordinator({
        repository: repo,
        dreamRunner: runner,
        vaultId,
        onRecordsChanged,
      });

      const result = await wired.handleExplicitCommand('记住：新的偏好', { vaultId });
      expect(result.handled).toBe(true);
      expect(onRecordsChanged).toHaveBeenCalledTimes(1);
    });
  });
});
