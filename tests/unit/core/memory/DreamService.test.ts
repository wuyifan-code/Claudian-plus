import type { AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';
import { ACTIVITY_FILE, SHORT_TERM_DIR, USER_FILE } from '@/core/memory/consciousness-types';
import { ConsciousnessEngine } from '@/core/memory/ConsciousnessEngine';
import {
  DREAM_DIR,
  DREAM_STATE_FILE,
  DreamService,
} from '@/core/memory/DreamService';
import { MemoryStore } from '@/core/memory/MemoryStore';
import type { ProviderId } from '@/core/providers/types';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function createMockAdapter(files: Record<string, string> = {}): VaultFileAdapter {
  const store = { ...files };
  return {
    exists: jest.fn(async (path: string) => path in store),
    read: jest.fn(async (path: string) => {
      if (!(path in store)) throw new Error(`File not found: ${path}`);
      return store[path];
    }),
    write: jest.fn(async (path: string, content: string) => {
      store[path] = content;
    }),
    append: jest.fn(async (path: string, content: string) => {
      store[path] = `${store[path] ?? ''}${content}`;
    }),
    delete: jest.fn(async (path: string) => {
      delete store[path];
    }),
    listFilesRecursive: jest.fn(async (folder: string) => {
      return Object.keys(store).filter(path => path.startsWith(`${folder}/`));
    }),
    listFiles: jest.fn(async () => []),
    listFolders: jest.fn(async () => []),
    ensureFolder: jest.fn(),
    rename: jest.fn(),
    stat: jest.fn(async (path: string) => {
      if (!(path in store)) return null;
      return { mtime: 1000, size: store[path].length };
    }),
    deleteFolder: jest.fn(),
  } as unknown as VaultFileAdapter;
}

function createFakeRunner(response: string): {
  runner: AuxQueryRunner;
  queryMock: jest.Mock;
} {
  const queryMock = jest.fn(async (_config: unknown, _prompt: string) => response);
  return {
    runner: { query: queryMock, reset: jest.fn() } as unknown as AuxQueryRunner,
    queryMock,
  };
}

interface ServiceHarness {
  adapter: VaultFileAdapter;
  service: DreamService;
  queryMock: jest.Mock;
  runnerFactory: jest.Mock;
}

function createHarness(options: {
  files?: Record<string, string>;
  response?: string;
  enabled?: boolean;
  privacy?: { allowImplicitExtraction: boolean };
  intervalMs?: number;
  context?: { providerId: ProviderId; model: string | null } | null;
} = {}): ServiceHarness {
  const adapter = createMockAdapter(options.files);
  const memoryStore = new MemoryStore(adapter);
  const consciousness = new ConsciousnessEngine(adapter, {
    enabled: true,
    autoMemoryEnabled: true,
    privacy: {
      allowImplicitExtraction: options.privacy?.allowImplicitExtraction ?? true,
      includeSourceContext: true,
      requireConfirmationForImplicit: false,
    },
  });

  const { runner, queryMock } = createFakeRunner(
    options.response ?? JSON.stringify({
      newFacts: [{ category: 'User Preferences', content: 'Prefers dark mode' }],
      profileUpdates: [{ section: '偏好', content: 'Prefers dark mode in all apps' }],
      insights: [{ content: 'User values privacy' }],
    }),
  );
  const runnerFactory = jest.fn(() => runner);

  const service = new DreamService({
    adapter,
    memoryStore,
    consciousness,
    createRunner: runnerFactory,
    getConversationContext: () => options.context ?? null,
    isEnabled: () => options.enabled ?? true,
    config: { intervalMs: options.intervalMs ?? 0 },
  });

  return { adapter, service, queryMock, runnerFactory };
}

function dayLog(date: string, content: string): Record<string, string> {
  return { [`${SHORT_TERM_DIR}/${date}.md`]: content };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

const TODAY = new Date().toISOString().split('T')[0];
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

describe('DreamService', () => {
  describe('gating', () => {
    it('skips when the feature is disabled', async () => {
      const { service } = createHarness({ enabled: false });

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: false, reason: 'disabled' });
    });

    it('skips when there are no pending logs', async () => {
      const { service } = createHarness();

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: false, reason: 'no-new-logs' });
    });

    it('ignores already-processed logs', async () => {
      const { service } = createHarness({
        files: {
          ...dayLog(TODAY, 'User: hello again'),
          [DREAM_STATE_FILE]: JSON.stringify({
            lastDreamAt: 0,
            processedLogs: [`${TODAY}.md`],
          }),
        },
      });

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: false, reason: 'no-new-logs' });
    });

    it('rejects concurrent runs while one is in flight', async () => {
      const adapter = createMockAdapter({
        ...dayLog(TODAY, 'User: hi'),
      });
      const memoryStore = new MemoryStore(adapter);
      const consciousness = new ConsciousnessEngine(adapter, {
        enabled: true,
        autoMemoryEnabled: true,
      });
      let releaseQuery!: (value: string) => void;
      const queryMock = jest.fn(() => new Promise<string>((resolve) => {
        releaseQuery = resolve;
      }));
      const service = new DreamService({
        adapter,
        memoryStore,
        consciousness,
        createRunner: () => ({ query: queryMock, reset: jest.fn() }) as unknown as AuxQueryRunner,
      });

      const first = service.runDream(true);
      await waitFor(() => queryMock.mock.calls.length > 0);
      const second = await service.runDream(true);
      expect(second).toMatchObject({ ran: false, reason: 'already-running' });

      releaseQuery(JSON.stringify({ newFacts: [] }));
      const firstResult = await first;
      expect(firstResult.ran).toBe(true);
    });

    it('fails gracefully when the runner throws', async () => {
      const adapter = createMockAdapter({ ...dayLog(TODAY, 'User: hi') });
      const memoryStore = new MemoryStore(adapter);
      const consciousness = new ConsciousnessEngine(adapter, { enabled: true });
      const service = new DreamService({
        adapter,
        memoryStore,
        consciousness,
        createRunner: () => ({
          query: jest.fn(async () => { throw new Error('provider offline'); }),
          reset: jest.fn(),
        }) as unknown as AuxQueryRunner,
      });

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: false, reason: 'failed' });
      expect(result.error).toContain('provider offline');
    });
  });

  describe('consolidation', () => {
    it('writes facts, profile updates, journal, and state', async () => {
      const { adapter, service, queryMock, runnerFactory } = createHarness({
        files: {
          ...dayLog(YESTERDAY, 'User: 我喜欢用深色模式\nAssistant: 好的，已记录'),
          ...dayLog(TODAY, 'User: 我习惯每天早上工作'),
          [USER_FILE]: '# 用户画像\n\n## 偏好\n\n<!-- 由对话自动提取 -->\n',
        },
      });

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: true, newFacts: 1, profileUpdates: 1, insights: 1 });
      expect(result.journalPath).toBe(`${DREAM_DIR}/${TODAY}.md`);

      const memoryContent = await adapter.read('.claudian-plus/memory.md');
      expect(memoryContent).toContain('Prefers dark mode');
      expect(memoryContent).toContain('## Insights');
      expect(memoryContent).toContain('User values privacy');

      const userContent = await adapter.read(USER_FILE);
      expect(userContent).toContain('Prefers dark mode in all apps');

      const journal = await adapter.read(`${DREAM_DIR}/${TODAY}.md`);
      expect(journal).toContain('Prefers dark mode');
      expect(journal).toContain('User values privacy');
      expect(journal).toContain('Insights: 1');

      const state = JSON.parse(await adapter.read(DREAM_STATE_FILE)) as {
        lastDreamAt: number;
        processedLogs: string[];
        processedFingerprints: Record<string, string>;
      };
      expect(state.lastDreamAt).toBeGreaterThan(0);
      expect(state.processedLogs).toEqual(expect.arrayContaining([`${TODAY}.md`, `${YESTERDAY}.md`]));
      expect(state.processedFingerprints[`${TODAY}.md`]).toBeDefined();

      const activity = JSON.parse(await adapter.read(ACTIVITY_FILE)) as Array<{ type: string }>;
      expect(activity.some(entry => entry.type === 'consolidation')).toBe(true);

      expect(runnerFactory).toHaveBeenCalledWith('claude');
      expect(queryMock).toHaveBeenCalledTimes(1);
      const [config, prompt] = queryMock.mock.calls[0];
      expect(config.systemPrompt).toContain('memory consolidation');
      expect(prompt).toContain('深色模式');
    });

    it('passes the active conversation context to the runner', async () => {
      const { service, runnerFactory } = createHarness({
        files: { ...dayLog(TODAY, 'User: hi') },
        context: { providerId: 'codex' as ProviderId, model: 'gpt-5.6-sol' },
      });
      await service.runDream(true);

      expect(runnerFactory).toHaveBeenCalledWith('codex');
      const queryCalls = runnerFactory.mock.results[0].value.query as jest.Mock;
      expect(queryCalls.mock.calls[0][0].model).toBe('gpt-5.6-sol');
    });

    it('does not re-add facts already present in long-term memory', async () => {
      const adapter = createMockAdapter({
        ...dayLog(TODAY, 'User: hi'),
        '.claudian-plus/memory.md': [
          '# Claudian Plus Memory',
          '',
          '## User Preferences',
          '',
          '- Prefers dark mode',
          '',
        ].join('\n'),
      });
      const memoryStore = new MemoryStore(adapter);
      const consciousness = new ConsciousnessEngine(adapter, { enabled: true, autoMemoryEnabled: true });
      const { runner } = createFakeRunner(JSON.stringify({
        newFacts: [{ category: 'User Preferences', content: 'Prefers dark mode' }],
      }));
      const service = new DreamService({
        adapter,
        memoryStore,
        consciousness,
        createRunner: () => runner,
      });

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: true, newFacts: 0 });
      const memoryContent = await adapter.read('.claudian-plus/memory.md');
      expect(memoryContent.match(/- Prefers dark mode/g)).toHaveLength(1);
    });

    it('re-dreams a log appended after it was processed', async () => {
      const { adapter, service } = createHarness({
        files: {
          ...dayLog(TODAY, 'User: morning'),
          [DREAM_STATE_FILE]: JSON.stringify({
            lastDreamAt: 0,
            processedLogs: [`${TODAY}.md`],
            processedFingerprints: {
              [`${TODAY}.md`]: `1000:${'User: morning'.length}`,
            },
          }),
        },
      });

      expect((await service.runDream(true)).ran).toBe(false);

      await adapter.append(`${SHORT_TERM_DIR}/${TODAY}.md`, '\nUser: evening');

      const result = await service.runDream(true);
      expect(result).toMatchObject({ ran: true, newFacts: 1 });

      const state = JSON.parse(await adapter.read(DREAM_STATE_FILE)) as {
        processedFingerprints: Record<string, string>;
      };
      const appendedContent = 'User: morning\nUser: evening';
      expect(state.processedFingerprints[`${TODAY}.md`]).toBe(`1000:${appendedContent.length}`);
    });

    it('skips unchanged logs recorded with fingerprints', async () => {
      const { service } = createHarness({
        files: {
          ...dayLog(TODAY, 'User: morning'),
          [DREAM_STATE_FILE]: JSON.stringify({
            lastDreamAt: 0,
            processedLogs: [`${TODAY}.md`],
            processedFingerprints: {
              [`${TODAY}.md`]: `1000:${'User: morning'.length}`,
            },
          }),
        },
      });

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: false, reason: 'no-new-logs' });
    });

    it('drops profile updates duplicating a fact from the same dream', async () => {
      const { adapter, service } = createHarness({
        files: {
          ...dayLog(TODAY, 'User: hi'),
          [USER_FILE]: '# 用户画像\n\n## 偏好\n\n<!-- 由对话自动提取 -->\n',
        },
        response: JSON.stringify({
          newFacts: [{ category: 'User Preferences', content: 'Prefers dark mode' }],
          profileUpdates: [{ section: '偏好', content: 'Prefers dark mode' }],
        }),
      });

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: true, newFacts: 1, profileUpdates: 0 });
      const memoryContent = await adapter.read('.claudian-plus/memory.md');
      expect(memoryContent.match(/- Prefers dark mode/g)).toHaveLength(1);
      const userContent = await adapter.read(USER_FILE);
      expect(userContent).not.toContain('Prefers dark mode');
    });

    it('does not re-add insights already present in long-term memory', async () => {
      const { adapter, service } = createHarness({
        files: {
          ...dayLog(TODAY, 'User: hi'),
          '.claudian-plus/memory.md': [
            '# Claudian Plus Memory',
            '',
            '## Insights',
            '',
            '- User values privacy',
            '',
          ].join('\n'),
        },
        response: JSON.stringify({
          insights: [{ content: 'User values privacy' }],
        }),
      });

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: true, newFacts: 0, insights: 0 });
      const memoryContent = await adapter.read('.claudian-plus/memory.md');
      expect(memoryContent.match(/- User values privacy/g)).toHaveLength(1);
    });

    it('skips profile updates when implicit extraction is disallowed', async () => {
      const { adapter, service } = createHarness({
        files: {
          ...dayLog(TODAY, 'User: hi'),
          [USER_FILE]: '# 用户画像\n\n## 偏好\n\n<!-- 由对话自动提取 -->\n',
        },
        privacy: { allowImplicitExtraction: false },
      });

      const result = await service.runDream(true);

      expect(result).toMatchObject({ ran: true, profileUpdates: 0 });
      const userContent = await adapter.read(USER_FILE);
      expect(userContent).not.toContain('Prefers dark mode');
    });

    it('considers legacy short-term logs', async () => {
      const { adapter, service } = createHarness({
        files: {
          ['.claudian/awareness/memory/2026-08-06.md']: 'User: legacy content',
        },
      });

      const result = await service.runDream(true);

      expect(result.ran).toBe(true);
      const state = JSON.parse(await adapter.read(DREAM_STATE_FILE)) as {
        processedLogs: string[];
      };
      expect(state.processedLogs).toContain('2026-08-06.md');
    });
  });

  describe('isDreamDue', () => {
    it('returns false before the interval elapses', async () => {
      const { service } = createHarness({
        files: {
          ...dayLog(TODAY, 'User: hi'),
          [DREAM_STATE_FILE]: JSON.stringify({ lastDreamAt: Date.now(), processedLogs: [] }),
        },
        intervalMs: 60 * 60 * 1000,
      });

      expect(await service.isDreamDue()).toBe(false);
    });

    it('returns true when interval elapsed and material is ready', async () => {
      const { service } = createHarness({
        files: {
          ...dayLog(TODAY, 'User: hi'),
          '.claudian-plus/memory.md': [
            '# Claudian Plus Memory',
            '',
            '## User Preferences',
            '',
            ...Array.from({ length: 10 }, (_, i) => `- memory entry ${i}`),
            '',
          ].join('\n'),
          [DREAM_STATE_FILE]: JSON.stringify({
            lastDreamAt: Date.now() - 2 * 60 * 60 * 1000,
            processedLogs: Array.from({ length: 5 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}.md`),
          }),
        },
        intervalMs: 60 * 60 * 1000,
      });

      expect(await service.isDreamDue()).toBe(true);
    });

    it('returns false when disabled', async () => {
      const { service } = createHarness({ enabled: false });
      expect(await service.isDreamDue()).toBe(false);
    });
  });
});
