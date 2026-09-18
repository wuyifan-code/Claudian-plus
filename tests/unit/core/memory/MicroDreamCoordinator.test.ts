import { AuxiliaryRequestGate } from '@/core/auxiliary/AuxiliaryRequestPolicy';
import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import type { MemoryStore } from '@/core/memory/MemoryStore';
import { MicroDreamCoordinator } from '@/core/memory/MicroDreamCoordinator';
import { MindStore } from '@/core/memory/MindStore';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

describe('MicroDreamCoordinator', () => {
  let mockAdapter: jest.Mocked<VaultFileAdapter>;
  let mindStore: MindStore;
  let mockRunner: jest.Mocked<AuxQueryRunner>;
  let createRunner: jest.Mock;

  beforeEach(async () => {
    const files: Record<string, string> = {};
    mockAdapter = {
      exists: jest.fn().mockImplementation(async (path: string) => path in files),
      read: jest.fn().mockImplementation(async (path: string) => files[path] || ''),
      write: jest.fn().mockImplementation(async (path: string, content: string) => {
        files[path] = content;
      }),
      ensureFolder: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VaultFileAdapter>;

    mindStore = new MindStore(mockAdapter);
    await mindStore.initialize();

    mockRunner = {
      query: jest.fn(),
      reset: jest.fn(),
    } as unknown as jest.Mocked<AuxQueryRunner>;

    createRunner = jest.fn().mockReturnValue(mockRunner);
  });

  it('skips micro-dream if session has fewer turns than minTurns and no tool calls', async () => {
    const coordinator = new MicroDreamCoordinator({
      mindStore,
      createRunner,
      minTurns: 3,
    });

    const result = await coordinator.evaluateSession({
      id: 'sess-short',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
      hasToolCalls: false,
    });

    expect(result.ran).toBe(false);
    expect(result.reason).toBe('insubstantial');
    expect(createRunner).not.toHaveBeenCalled();
  });

  it('runs micro-dream when session turns >= minTurns', async () => {
    mockRunner.query.mockResolvedValueOnce(
      JSON.stringify({
        rules: [
          {
            category: 'user_preference',
            scope: 'global',
            content: 'Always respond in Chinese',
            rationale: 'User asked in Chinese',
            confidence: 0.9,
          },
        ],
      }),
    );

    const coordinator = new MicroDreamCoordinator({
      mindStore,
      createRunner,
      minTurns: 2,
    });

    const result = await coordinator.evaluateSession({
      id: 'sess-long',
      messages: [
        { role: 'user', content: '请用中文回答我关于 TypeScript 的问题' },
        { role: 'assistant', content: '好的，请问您有什么具体问题？' },
        { role: 'user', content: '如何在 TS 中定义泛型约束？' },
        { role: 'assistant', content: '使用 extends 关键字...' },
      ],
      hasToolCalls: false,
    });

    expect(result.ran).toBe(true);
    expect(result.newStagingCount).toBe(1);

    const staging = await mindStore.listStaging();
    expect(staging).toHaveLength(1);
    expect(staging[0].content).toBe('Always respond in Chinese');
    expect(staging[0].category).toBe('user_preference');
  });

  it('triggers when hasToolCalls is true even if turn count is low', async () => {
    mockRunner.query.mockResolvedValueOnce(
      JSON.stringify({
        rules: [
          {
            category: 'project_rule',
            scope: 'project',
            content: 'Do not modify lockfile manually',
            rationale: 'Tool run error',
            confidence: 0.85,
          },
        ],
      }),
    );

    const coordinator = new MicroDreamCoordinator({
      mindStore,
      createRunner,
      minTurns: 5,
    });

    const result = await coordinator.evaluateSession({
      id: 'sess-tool',
      messages: [
        { role: 'user', content: 'run tests' },
        { role: 'assistant', content: 'Running command...' },
      ],
      hasToolCalls: true,
    });

    expect(result.ran).toBe(true);
    expect(result.newStagingCount).toBe(1);
  });

  it('handles aux runner errors gracefully without throwing', async () => {
    mockRunner.query.mockRejectedValueOnce(new Error('Network offline'));

    const coordinator = new MicroDreamCoordinator({
      mindStore,
      createRunner,
      minTurns: 2,
    });

    const result = await coordinator.evaluateSession({
      id: 'sess-error',
      messages: [
        { role: 'user', content: 'turn 1' },
        { role: 'assistant', content: 'turn 1 reply' },
        { role: 'user', content: 'turn 2' },
        { role: 'assistant', content: 'turn 2 reply' },
      ],
    });

    expect(result.ran).toBe(false);
    expect(result.reason).toBe('failed');
    expect(result.error).toContain('Network offline');
  });

  it('includes MemoryStore entries in prompt and avoids duplicate staging proposals', async () => {
    const memoryStore = {
      load: jest.fn().mockResolvedValue([
        { id: 'm1', content: 'Prefers PNPM package manager', category: 'Tools' },
      ]),
    };

    mockRunner.query.mockImplementation(async (_config, prompt) => {
      expect(prompt).toContain('Prefers PNPM package manager');
      return JSON.stringify({
        rules: [
          {
            category: 'coding_habit',
            scope: 'project',
            content: 'Prefers PNPM package manager',
            rationale: 'Mentioned in session',
            confidence: 0.9,
          },
        ],
      });
    });

    const coordinator = new MicroDreamCoordinator({
      mindStore,
      createRunner,
      getMemoryStore: () => memoryStore as unknown as MemoryStore,
      minTurns: 1,
    });

    const result = await coordinator.evaluateSession({
      id: 'sess-pnpm',
      messages: [
        { role: 'user', content: 'Let us run pnpm test' },
        { role: 'assistant', content: 'Running pnpm test...' },
      ],
      hasToolCalls: true,
    });

    expect(result.ran).toBe(true);
    // Duplicate rule was rejected by cross-deduplication in MindStore
    expect(result.newStagingCount).toBe(0);
    const staging = await mindStore.listStaging();
    expect(staging).toHaveLength(0);
  });

  it('invokes onNewStaging callback when new rules are synthesized', async () => {
    const onNewStagingSpy = jest.fn();
    mockRunner.query.mockResolvedValueOnce(
      JSON.stringify({
        rules: [
          {
            category: 'coding_habit',
            scope: 'project',
            content: 'Use functional components with hooks',
            rationale: 'Observed coding style',
            confidence: 0.9,
          },
        ],
      }),
    );

    const coordinator = new MicroDreamCoordinator({
      mindStore,
      createRunner,
      minTurns: 1,
      onNewStaging: onNewStagingSpy,
    });

    const result = await coordinator.evaluateSession({
      id: 'sess-callback',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
      hasToolCalls: true,
    });

    expect(result.ran).toBe(true);
    expect(result.newStagingCount).toBe(1);
    expect(onNewStagingSpy).toHaveBeenCalledWith(1);
  });

  it('records evaluation watermark and prevents redundant evaluation', async () => {
    mockRunner.query.mockResolvedValue(
      JSON.stringify({
        rules: [
          {
            category: 'coding_habit',
            scope: 'project',
            content: 'Prefer pure functions',
            rationale: 'Observed style',
            confidence: 0.9,
          },
        ],
      }),
    );

    const coordinator = new MicroDreamCoordinator({
      mindStore,
      createRunner,
      minTurns: 2,
    });

    const messages = [
      { role: 'user', content: 'hello turn 1' },
      { role: 'assistant', content: 'reply 1' },
      { role: 'user', content: 'hello turn 2' },
      { role: 'assistant', content: 'reply 2' },
    ];

    // First evaluation: should run
    const result1 = await coordinator.evaluateSession({
      id: 'sess-watermark',
      messages,
    });
    expect(result1.ran).toBe(true);
    expect(coordinator.getLastEvaluatedTurnCount('sess-watermark')).toBe(2);
    expect(createRunner).toHaveBeenCalledTimes(1);

    // Second evaluation with identical messages: should skip due to watermark
    const result2 = await coordinator.evaluateSession({
      id: 'sess-watermark',
      messages,
    });
    expect(result2.ran).toBe(false);
    expect(result2.reason).toBe('redundant');
    expect(createRunner).toHaveBeenCalledTimes(1);

    // Third evaluation with an additional user turn: should run again
    const updatedMessages = [
      ...messages,
      { role: 'user', content: 'hello turn 3' },
      { role: 'assistant', content: 'reply 3' },
    ];
    const result3 = await coordinator.evaluateSession({
      id: 'sess-watermark',
      messages: updatedMessages,
    });
    expect(result3.ran).toBe(true);
    expect(coordinator.getLastEvaluatedTurnCount('sess-watermark')).toBe(3);
    expect(createRunner).toHaveBeenCalledTimes(2);

    // Clear watermark: should allow re-evaluation
    coordinator.clearWatermark('sess-watermark');
    expect(coordinator.getLastEvaluatedTurnCount('sess-watermark')).toBeUndefined();
  });

  it('deduplicates concurrent in-flight evaluations for the same session', async () => {
    let resolveQuery!: (val: string) => void;
    const queryPromise = new Promise<string>((resolve) => {
      resolveQuery = resolve;
    });
    mockRunner.query.mockReturnValue(queryPromise);

    const coordinator = new MicroDreamCoordinator({
      mindStore,
      createRunner,
      minTurns: 2,
    });

    const messages = [
      { role: 'user', content: 'turn 1' },
      { role: 'assistant', content: 'reply 1' },
      { role: 'user', content: 'turn 2' },
      { role: 'assistant', content: 'reply 2' },
    ];

    // Trigger two evaluations concurrently before the first resolves
    const evalPromise1 = coordinator.evaluateSession({ id: 'sess-concurrent', messages });
    const evalPromise2 = coordinator.evaluateSession({ id: 'sess-concurrent', messages });

    resolveQuery(JSON.stringify({
      rules: [
        {
          category: 'project_rule',
          scope: 'project',
          content: 'Test rule',
          rationale: 'Test',
          confidence: 0.9,
        },
      ],
    }));

    const [res1, res2] = await Promise.all([evalPromise1, evalPromise2]);
    expect(res1).toBe(res2);
    expect(res1.ran).toBe(true);
    expect(createRunner).toHaveBeenCalledTimes(1);
  });

  describe('saving mode and background budget', () => {
    const SUBSTANTIAL_MESSAGES = [
      { role: 'user', content: 'turn 1' },
      { role: 'assistant', content: 'reply 1' },
      { role: 'user', content: 'turn 2' },
      { role: 'assistant', content: 'reply 2' },
    ];

    function createGate(
      overrides: Partial<ConstructorParameters<typeof AuxiliaryRequestGate>[0]> = {},
    ): AuxiliaryRequestGate {
      return new AuxiliaryRequestGate({
        resolveSavingMode: () => 'standard',
        resolveDailyLimit: () => null,
        ...overrides,
      });
    }

    function createCoordinator(
      gate: AuxiliaryRequestGate,
    ): MicroDreamCoordinator {
      return new MicroDreamCoordinator({
        mindStore,
        createRunner,
        minTurns: 2,
        backgroundRequestGate: gate,
      });
    }

    it('issues no model request for an automatic micro-dream trigger in economy mode', async () => {
      const gate = createGate({ resolveSavingMode: () => 'economy' });
      const coordinator = createCoordinator(gate);

      const result = await coordinator.evaluateSession({
        id: 'sess-economy',
        messages: SUBSTANTIAL_MESSAGES,
      });

      expect(result).toMatchObject({ ran: false, reason: 'saving-mode' });
      expect(result.error).toBeUndefined();
      expect(createRunner).not.toHaveBeenCalled();
      expect(gate.getIssuedToday()).toBe(0);
      expect(coordinator.getLastEvaluatedTurnCount('sess-economy')).toBeUndefined();
    });

    it('skips quietly without advancing the watermark when the daily budget is exhausted', async () => {
      let dailyLimit: number | null = 1;
      const gate = createGate({ resolveDailyLimit: () => dailyLimit });
      gate.tryBegin();
      gate.end();
      const coordinator = createCoordinator(gate);

      const result = await coordinator.evaluateSession({
        id: 'sess-capped',
        messages: SUBSTANTIAL_MESSAGES,
      });

      expect(result).toMatchObject({ ran: false, reason: 'budget-exceeded' });
      expect(createRunner).not.toHaveBeenCalled();
      expect(coordinator.getLastEvaluatedTurnCount('sess-capped')).toBeUndefined();

      // Budget headroom restored (user raises the cap or the day rolls over):
      // the same turn count is retried, not treated as redundant.
      dailyLimit = 2;
      mockRunner.query.mockResolvedValueOnce(JSON.stringify({ rules: [] }));
      const retried = await coordinator.evaluateSession({
        id: 'sess-capped',
        messages: SUBSTANTIAL_MESSAGES,
      });
      expect(retried.ran).toBe(true);
      expect(createRunner).toHaveBeenCalledTimes(1);
      expect(gate.getIssuedToday()).toBe(2);
    });

    it('does not spend the budget on sessions rejected by the cheap local gates', async () => {
      const gate = createGate({ resolveDailyLimit: () => 1 });
      gate.tryBegin();
      gate.end();
      const coordinator = createCoordinator(gate);

      const result = await coordinator.evaluateSession({
        id: 'sess-short',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      });

      expect(result).toMatchObject({ ran: false, reason: 'insubstantial' });
      expect(gate.getIssuedToday()).toBe(1);
    });

    async function waitForSlotAcquired(gate: AuxiliaryRequestGate): Promise<void> {
      const start = Date.now();
      while (gate.getInFlightCount() === 0) {
        if (Date.now() - start > 1000) {
          throw new Error('background slot was never acquired');
        }
        await new Promise(resolve => setTimeout(resolve, 2));
      }
    }

    it('enforces single concurrency across different sessions through the shared gate', async () => {
      const gate = createGate();
      let releaseFirst!: (value: string) => void;
      mockRunner.query.mockImplementationOnce(() => new Promise<string>((resolve) => {
        releaseFirst = resolve;
      }));
      mockRunner.query.mockResolvedValueOnce(JSON.stringify({ rules: [] }));
      const coordinator = createCoordinator(gate);

      const first = coordinator.evaluateSession({
        id: 'sess-first',
        messages: SUBSTANTIAL_MESSAGES,
      });
      await waitForSlotAcquired(gate);
      const second = await coordinator.evaluateSession({
        id: 'sess-second',
        messages: SUBSTANTIAL_MESSAGES,
      });

      expect(second).toMatchObject({ ran: false, reason: 'busy' });
      expect(createRunner).toHaveBeenCalledTimes(1);

      releaseFirst(JSON.stringify({ rules: [] }));
      const firstResult = await first;
      expect(firstResult.ran).toBe(true);
    });

    it('still counts a micro-dream whose runner fails after being issued', async () => {
      const gate = createGate({ resolveDailyLimit: () => 1 });
      mockRunner.query.mockRejectedValueOnce(new Error('provider offline'));
      const coordinator = createCoordinator(gate);

      const result = await coordinator.evaluateSession({
        id: 'sess-failing',
        messages: SUBSTANTIAL_MESSAGES,
      });

      expect(result).toMatchObject({ ran: false, reason: 'failed' });
      expect(gate.getIssuedToday()).toBe(1);

      const next = await coordinator.evaluateSession({
        id: 'sess-failing',
        messages: SUBSTANTIAL_MESSAGES,
      });
      expect(next).toMatchObject({ ran: false, reason: 'budget-exceeded' });
      expect(createRunner).toHaveBeenCalledTimes(1);
    });

    it('behaves as before when no gate is configured', async () => {
      mockRunner.query.mockResolvedValueOnce(JSON.stringify({ rules: [] }));
      const coordinator = new MicroDreamCoordinator({
        mindStore,
        createRunner,
        minTurns: 2,
      });

      const result = await coordinator.evaluateSession({
        id: 'sess-ungated',
        messages: SUBSTANTIAL_MESSAGES,
      });

      expect(result.ran).toBe(true);
      expect(createRunner).toHaveBeenCalledTimes(1);
    });
  });
});
