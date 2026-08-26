import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
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
});
