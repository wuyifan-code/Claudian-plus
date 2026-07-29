import { Notice } from 'obsidian';

import { SharedStorageService } from '@/app/storage/SharedStorageService';

describe('SharedStorageService', () => {
  it('does not create storage directories during read-only initialization', async () => {
    const adapter = {
      exists: jest.fn().mockResolvedValue(false),
      read: jest.fn(),
      write: jest.fn(),
      mkdir: jest.fn(),
    };
    const plugin = {
      app: { vault: { adapter } },
    } as any;
    const storage = new SharedStorageService(plugin);

    await storage.initialize();

    expect(adapter.mkdir).not.toHaveBeenCalled();
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('reports and propagates tab layout persistence failures', async () => {
    const error = new Error('disk full');
    const plugin = {
      app: { vault: { adapter: {} } },
      loadData: jest.fn().mockResolvedValue({ existing: true }),
      saveData: jest.fn().mockRejectedValue(error),
    } as any;
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
    const plugin = {
      app: { vault: { adapter: {} } },
      loadData: jest.fn().mockImplementation(async () => ({ existing: true })),
      saveData: jest.fn()
        .mockImplementationOnce(async (data: Record<string, unknown>) => {
          await firstWrite;
          persistedData = data;
        })
        .mockImplementationOnce(async (data: Record<string, unknown>) => {
          persistedData = data;
        }),
    } as any;
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
});
