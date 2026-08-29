import type { MemoryStore } from '@/core/memory/MemoryStore';
import type { DurableMindEntry, StagingMindEntry } from '@/core/memory/mind-types';
import { MindStore } from '@/core/memory/MindStore';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

describe('MindStore', () => {
  let mockAdapter: jest.Mocked<VaultFileAdapter>;
  let files: Record<string, string>;

  beforeEach(() => {
    files = {};
    mockAdapter = {
      exists: jest.fn().mockImplementation(async (path: string) => path in files),
      read: jest.fn().mockImplementation(async (path: string) => {
        if (path in files) return files[path];
        throw new Error(`File not found: ${path}`);
      }),
      write: jest.fn().mockImplementation(async (path: string, content: string) => {
        files[path] = content;
      }),
      delete: jest.fn().mockImplementation(async (path: string) => {
        delete files[path];
      }),
      ensureFolder: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<VaultFileAdapter>;
  });

  it('initializes and creates storage files if they do not exist', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    expect(mockAdapter.ensureFolder).toHaveBeenCalledWith('.claudian-plus/awareness');
    const staging = await store.listStaging();
    const durable = await store.listDurable();

    expect(staging).toEqual([]);
    expect(durable).toEqual([]);
  });

  it('adds staging entries and prevents duplicate staging content', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    const entry1: Omit<StagingMindEntry, 'id' | 'createdAt'> = {
      category: 'coding_habit',
      scope: 'project',
      content: 'Always use pnpm over npm',
      rationale: 'Observed user running pnpm test',
      sourceSessionId: 'sess-1',
      confidence: 0.9,
    };

    const added = await store.addStaging(entry1);
    expect(added).not.toBeNull();
    expect(added?.content).toBe(entry1.content);

    // Adding duplicate content should be ignored/return null
    const duplicate = await store.addStaging(entry1);
    expect(duplicate).toBeNull();

    const stagingList = await store.listStaging();
    expect(stagingList).toHaveLength(1);
  });

  it('approves a staging entry into durable memory and removes it from staging', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    const added = await store.addStaging({
      category: 'project_rule',
      scope: 'project',
      content: 'Providers must not depend on features',
      rationale: 'Architecture rule mentioned in prompt',
      sourceSessionId: 'sess-2',
      confidence: 0.95,
    });

    expect(added).not.toBeNull();
    const approved = await store.approveStaging(added!.id);
    expect(approved).not.toBeNull();
    expect(approved?.state).toBe('active');
    expect(approved?.content).toBe(added!.content);

    const stagingList = await store.listStaging();
    expect(stagingList).toHaveLength(0);

    const durableList = await store.listDurable();
    expect(durableList).toHaveLength(1);
    expect(durableList[0].id).toBe(approved!.id);
  });

  it('dismisses a staging entry', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    const added = await store.addStaging({
      category: 'user_preference',
      scope: 'global',
      content: 'Reply in concise bullet points',
      rationale: 'User request',
      sourceSessionId: 'sess-3',
      confidence: 0.8,
    });

    await store.dismissStaging(added!.id);
    const stagingList = await store.listStaging();
    expect(stagingList).toHaveLength(0);
  });

  it('approves all staging entries at once', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    await store.addStaging({
      category: 'user_preference',
      scope: 'global',
      content: 'Rule 1',
      rationale: 'R1',
      sourceSessionId: 's1',
      confidence: 0.8,
    });
    await store.addStaging({
      category: 'project_rule',
      scope: 'project',
      content: 'Rule 2',
      rationale: 'R2',
      sourceSessionId: 's2',
      confidence: 0.9,
    });

    const approvedList = await store.approveAllStaging();
    expect(approvedList).toHaveLength(2);
    expect(await store.listStaging()).toHaveLength(0);
    expect(await store.listDurable()).toHaveLength(2);
  });

  it('supports updating and deleting durable entries', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    const durable: Omit<DurableMindEntry, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt'> = {
      category: 'coding_habit',
      scope: 'project',
      state: 'active',
      content: 'Use Vitest',
      confidence: 0.9,
      tags: ['test', 'vitest'],
      matchPatterns: ['**/*.test.ts'],
    };

    const created = await store.addDurable(durable);
    expect(created?.id).toBeDefined();

    const updated = await store.updateDurable(created!.id, {
      content: 'Use Jest for unit tests',
      state: 'active',
    });
    expect(updated?.content).toBe('Use Jest for unit tests');

    await store.deleteDurable(created!.id);
    expect(await store.listDurable()).toHaveLength(0);
  });

  it('records hit on durable entry and updates lastUsedAt and confidence', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    const created = await store.addDurable({
      category: 'user_preference',
      scope: 'global',
      state: 'active',
      content: 'Use Chinese response',
      confidence: 0.7,
      tags: ['lang'],
    });

    const hit = await store.recordHit(created!.id);
    expect(hit?.lastUsedAt).toBeGreaterThan(0);
    expect(hit?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('applies decay to stale unreferenced entries', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    const created = await store.addDurable({
      category: 'project_rule',
      scope: 'project',
      state: 'active',
      content: 'Temporary migration rule',
      confidence: 0.5,
      tags: ['migration'],
    });

    // Manually backdate lastUsedAt
    await store.updateDurable(created!.id, {
      lastUsedAt: Date.now() - 40 * 24 * 60 * 60 * 1000, // 40 days ago
    });

    const decayed = await store.applyDecay(30 * 24 * 60 * 60 * 1000); // 30 days
    expect(decayed).toHaveLength(1);
    expect(decayed[0].state).toBe('stale');
  });

  it('notifies listeners on staging changes and reports getStagingCount', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    const counts: number[] = [];
    const unsubscribe = store.onStagingChanged((count) => counts.push(count));

    expect(await store.getStagingCount()).toBe(0);

    const stg = await store.addStaging({
      category: 'user_preference',
      scope: 'project',
      content: 'Prefer concise answers',
      rationale: 'Observed',
      sourceSessionId: 's1',
      confidence: 0.9,
    });

    expect(counts).toEqual([1]);
    expect(await store.getStagingCount()).toBe(1);

    await store.dismissStaging(stg!.id);
    expect(counts).toEqual([1, 0]);
    expect(await store.getStagingCount()).toBe(0);

    unsubscribe();
    await store.addStaging({
      category: 'coding_habit',
      scope: 'global',
      content: 'Use functional style',
      rationale: 'Observed',
      sourceSessionId: 's2',
      confidence: 0.8,
    });
    // Should not record after unsubscribe
    expect(counts).toEqual([1, 0]);
  });

  it('forgets matching rule by keyword', async () => {
    const store = new MindStore(mockAdapter);
    await store.initialize();

    await store.addDurable({
      category: 'user_preference',
      scope: 'global',
      state: 'active',
      content: 'Always respond in Chinese',
      confidence: 0.95,
      tags: ['chinese', 'lang'],
    });

    await store.addDurable({
      category: 'project_rule',
      scope: 'project',
      state: 'active',
      content: 'Vitest unit testing is required',
      confidence: 0.9,
      tags: ['test'],
    });

    const forgotten = await store.forgetRule('Chinese');
    expect(forgotten).not.toBeNull();
    expect(forgotten?.content).toBe('Always respond in Chinese');

    const durableList = await store.listDurable();
    expect(durableList).toHaveLength(1);
    expect(durableList[0].content).toBe('Vitest unit testing is required');

    // Trying to forget non-existent rule
    const notFound = await store.forgetRule('nonexistent');
    expect(notFound).toBeNull();
  });

  it('prevents adding staging or durable entry when it duplicates an entry in MemoryStore', async () => {
    const memoryStore = {
      load: jest.fn().mockResolvedValue([
        { id: 'mem-1', content: 'Always use functional TypeScript style', category: 'Coding' },
      ]),
    };

    const store = new MindStore(mockAdapter, {
      getMemoryStore: () => memoryStore as unknown as MemoryStore,
    });
    await store.initialize();

    // Adding staging entry that duplicates MemoryStore should return null
    const duplicateStaging = await store.addStaging({
      category: 'coding_habit',
      scope: 'global',
      content: 'Always use functional TypeScript style',
      rationale: 'Extracted from chat',
      sourceSessionId: 's-1',
      confidence: 0.9,
    });
    expect(duplicateStaging).toBeNull();

    // Adding durable entry that duplicates MemoryStore should return null or existing
    const duplicateDurable = await store.addDurable({
      category: 'coding_habit',
      scope: 'global',
      content: 'Always use functional TypeScript style',
      confidence: 0.9,
      tags: [],
    });
    expect(duplicateDurable).toBeNull();
  });
});
