import { Notice } from 'obsidian';

import { SharedStorageService } from '@/app/storage/SharedStorageService';
import { AWARENESS_DIR, SOUL_FILE } from '@/core/memory/consciousness-types';

/** Minimal Obsidian `Plugin` double: vault events plus the plugin data store. */
function createPluginMock(
  vault: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): any {
  return {
    app: { vault: { ...vault, on: jest.fn(() => ({})) } },
    registerEvent: jest.fn(),
    ...overrides,
  };
}

describe('SharedStorageService', () => {
  it('does not create storage directories during read-only initialization', async () => {
    const adapter = {
      exists: jest.fn().mockResolvedValue(false),
      read: jest.fn(),
      write: jest.fn(),
      mkdir: jest.fn(),
    };
    const plugin = createPluginMock({ adapter });
    const storage = new SharedStorageService(plugin);

    await storage.initialize();

    expect(adapter.mkdir).not.toHaveBeenCalled();
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('reports whether a settings file already exists for upgrade detection', async () => {
    const adapter = {
      exists: jest.fn().mockResolvedValue(true),
      read: jest.fn().mockResolvedValue(JSON.stringify({ model: 'gpt-5.6-sol' })),
      write: jest.fn(),
      mkdir: jest.fn(),
    };
    const plugin = createPluginMock({ adapter });
    const storage = new SharedStorageService(plugin);

    const fresh = await storage.initialize();
    expect(fresh.hasPersistedSettings).toBe(true);

    adapter.exists.mockResolvedValue(false);
    const empty = await storage.initialize();
    expect(empty.hasPersistedSettings).toBe(false);
  });

  it('reports and propagates tab layout persistence failures', async () => {
    const error = new Error('disk full');
    const plugin = createPluginMock({ adapter: {} }, {
      loadData: jest.fn().mockResolvedValue({ existing: true }),
      saveData: jest.fn().mockRejectedValue(error),
    });
    const storage = new SharedStorageService(plugin);

    await expect(storage.setTabManagerState({
      activeTabId: null,
      openTabs: [],
    })).rejects.toBe(error);
    expect(Notice).toHaveBeenCalledWith('Failed to save tab layout');
  });

  it('keeps the newest layout when concurrent writes finish out of order', async () => {
    let releaseFirstWrite!: () => void;
    let persistedData: Record<string, unknown> = {};
    const firstWrite = new Promise<void>(resolve => {
      releaseFirstWrite = resolve;
    });
    const plugin = createPluginMock({ adapter: {} }, {
      loadData: jest.fn().mockImplementation(async () => ({ existing: true })),
      saveData: jest.fn()
        .mockImplementationOnce(async (data: Record<string, unknown>) => {
          await firstWrite;
          persistedData = data;
        })
        .mockImplementationOnce(async (data: Record<string, unknown>) => {
          persistedData = data;
        }),
    });
    const storage = new SharedStorageService(plugin);
    const olderState = {
      activeTabId: 'tab-old',
      openTabs: [{ tabId: 'tab-old', conversationId: 'conv-old' }],
    };
    const newerState = {
      activeTabId: 'tab-new',
      openTabs: [{ tabId: 'tab-new', conversationId: 'conv-new' }],
    };

    const firstSave = storage.setTabManagerState(olderState);
    await Promise.resolve();
    const secondSave = storage.setTabManagerState(newerState);
    await Promise.resolve();
    releaseFirstWrite();

    await Promise.all([firstSave, secondSave]);

    expect(persistedData).toEqual(expect.objectContaining({
      existing: true,
      tabManagerState: newerState,
    }));
  });

  describe('memory content cache invalidation', () => {
    it('registers vault listeners for every structural change', () => {
      const plugin = createPluginMock({ adapter: {} });
      new SharedStorageService(plugin);

      const events = plugin.app.vault.on.mock.calls.map((call: unknown[]) => call[0]);
      expect(events).toEqual(['modify', 'create', 'delete', 'rename']);
      expect(plugin.registerEvent).toHaveBeenCalledTimes(4);
    });

    it('drops a cached memory file when the vault reports an external edit', async () => {
      const files: Record<string, string> = { [SOUL_FILE]: 'original' };
      const adapter = {
        exists: jest.fn(async (path: string) => path in files || Object.keys(files).some(key => key.startsWith(`${path}/`))),
        read: jest.fn(async (path: string) => files[path]),
        write: jest.fn(async (path: string, content: string) => {
          files[path] = content;
        }),
      };
      const plugin = createPluginMock({ adapter });
      const storage = new SharedStorageService(plugin);
      const cache = storage.getContentCache();
      const vaultAdapter = storage.getAdapter();

      await expect(vaultAdapter.read(SOUL_FILE)).resolves.toBe('original');
      await vaultAdapter.read(SOUL_FILE);
      expect(adapter.read).toHaveBeenCalledTimes(1);

      files[SOUL_FILE] = 'edited in Obsidian';
      const modify = plugin.app.vault.on.mock.calls
        .find((call: unknown[]) => call[0] === 'modify')?.[1];
      modify({ path: SOUL_FILE });

      await expect(vaultAdapter.read(SOUL_FILE)).resolves.toBe('edited in Obsidian');
      expect(adapter.read).toHaveBeenCalledTimes(2);
      expect(cache.stats.entries).toBeGreaterThan(0);
    });

    it('keeps the memory file path configurable at runtime', async () => {
      const adapter = {
        exists: jest.fn().mockResolvedValue(true),
        read: jest.fn().mockResolvedValue('custom'),
      };
      const plugin = createPluginMock({ adapter });
      const storage = new SharedStorageService(plugin);

      storage.setMemoryFilePathProvider(() => 'notes/custom-memory.md');
      const vaultAdapter = storage.getAdapter();
      await vaultAdapter.read('notes/custom-memory.md');
      await vaultAdapter.read('notes/custom-memory.md');

      expect(adapter.read).toHaveBeenCalledTimes(1);
      expect(AWARENESS_DIR).toBe('.claudian-plus/awareness');
    });
  });
});
