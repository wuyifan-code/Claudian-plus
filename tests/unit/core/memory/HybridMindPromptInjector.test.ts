import { HybridMindPromptInjector } from '@/core/memory/HybridMindPromptInjector';
import { MemoryStore } from '@/core/memory/MemoryStore';
import { MindStore } from '@/core/memory/MindStore';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

describe('HybridMindPromptInjector', () => {
  let mockAdapter: jest.Mocked<VaultFileAdapter>;
  let mindStore: MindStore;

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
  });

  it('returns empty string when there are no durable mind entries', async () => {
    const injector = new HybridMindPromptInjector(mindStore);
    const result = await injector.buildPromptInjection({});
    expect(result).toBe('');
  });

  it('injects global user profile as Layer 1', async () => {
    await mindStore.addDurable({
      category: 'user_preference',
      scope: 'global',
      state: 'active',
      content: 'Always respond in Chinese',
      confidence: 0.95,
      tags: ['lang'],
    });

    const injector = new HybridMindPromptInjector(mindStore);
    const result = await injector.buildPromptInjection({});

    expect(result).toContain('<user_mind_profile>');
    expect(result).toContain('Always respond in Chinese');
    expect(result).not.toContain('<project_context_rules>');
  });

  it('injects project rules when active file path matches pattern', async () => {
    await mindStore.addDurable({
      category: 'project_rule',
      scope: 'project',
      state: 'active',
      content: 'Provider contracts must not import features',
      confidence: 0.9,
      matchPatterns: ['src/providers/**', 'src/core/providers/**'],
      tags: ['provider'],
    });

    const injector = new HybridMindPromptInjector(mindStore);

    // Should match
    const matched = await injector.buildPromptInjection({
      activeFilePath: 'src/providers/acp/AcpSubprocess.ts',
    });
    expect(matched).toContain('<project_context_rules>');
    expect(matched).toContain('Provider contracts must not import features');

    // Should not match
    const unmatched = await injector.buildPromptInjection({
      activeFilePath: 'src/features/chat/ClaudianPlusView.ts',
    });
    expect(unmatched).not.toContain('Provider contracts must not import features');
  });

  it('injects project rules when user prompt matches rule tags', async () => {
    const created = await mindStore.addDurable({
      category: 'coding_habit',
      scope: 'project',
      state: 'active',
      content: 'Always use Vitest with mocked adapter for unit tests',
      confidence: 0.85,
      tags: ['vitest', 'unit-test', 'mock'],
    });

    const injector = new HybridMindPromptInjector(mindStore);
    const result = await injector.buildPromptInjection({
      userPromptText: 'Help me write a vitest mock test for this class',
    });

    expect(result).toContain('<project_context_rules>');
    expect(result).toContain('Always use Vitest with mocked adapter');

    // Should record hit
    const updated = (await mindStore.listDurable()).find((e) => e.id === created!.id);
    expect(updated?.lastUsedAt).toBeGreaterThan(0);
  });

  it('respects character budget cap', async () => {
    for (let i = 0; i < 20; i++) {
      await mindStore.addDurable({
        category: 'user_preference',
        scope: 'global',
        state: 'active',
        content: `Global long preference rule number ${i} with substantial detailed text explaining requirements`,
        confidence: 0.9,
        tags: [],
      });
    }

    const injector = new HybridMindPromptInjector(mindStore, {
      maxGlobalChars: 150,
      maxProjectChars: 200,
    });
    const result = await injector.buildPromptInjection({});

    expect(result.length).toBeLessThan(350);
  });

  it('returns both injection text and recalledEntries with resolveInjection', async () => {
    await mindStore.addDurable({
      category: 'user_preference',
      scope: 'global',
      state: 'active',
      content: 'Always respond in Chinese',
      confidence: 0.95,
      tags: ['lang'],
    });

    await mindStore.addDurable({
      category: 'project_rule',
      scope: 'project',
      state: 'active',
      content: 'Use Obsidian mock adapters',
      confidence: 0.9,
      matchPatterns: ['tests/**'],
      tags: ['test'],
    });

    const injector = new HybridMindPromptInjector(mindStore);
    const resolved = await injector.resolveInjection({
      activeFilePath: 'tests/unit/example.test.ts',
      userPromptText: 'Help me write tests',
    });

    expect(resolved.injectionText).toContain('Always respond in Chinese');
    expect(resolved.injectionText).toContain('Use Obsidian mock adapters');
    expect(resolved.recalledEntries).toHaveLength(2);
    const contents = resolved.recalledEntries.map((e) => e.content);
    expect(contents).toContain('Always respond in Chinese');
    expect(contents).toContain('Use Obsidian mock adapters');
    expect(resolved.recalledEntries.find((e) => e.content === 'Always respond in Chinese')?.scope).toBe('global');
    expect(resolved.recalledEntries.find((e) => e.content === 'Use Obsidian mock adapters')?.scope).toBe('project');
  });

  it('injects non-duplicate entries from MemoryStore and respects total budget', async () => {
    const memoryStore = new MemoryStore(mockAdapter);
    await memoryStore.add({
      category: 'User Preferences',
      content: 'Always respond in Chinese', // Duplicate of Mind global rule below
      source: 'user-explicit',
    });
    await memoryStore.add({
      category: 'Project Context',
      content: 'Database is PostgreSQL 16', // Unique to memory.md
      source: 'user-explicit',
    });

    await mindStore.addDurable({
      category: 'user_preference',
      scope: 'global',
      state: 'active',
      content: 'Always respond in Chinese',
      confidence: 0.95,
      tags: ['lang'],
    });

    const injector = new HybridMindPromptInjector(mindStore, {
      getMemoryStore: () => memoryStore,
      isMemoryStoreEnabled: () => true,
      maxTotalChars: 1500,
    });

    const result = await injector.buildPromptInjection({});

    expect(result).toContain('<user_mind_profile>');
    expect(result).toContain('Always respond in Chinese');
    expect(result).toContain('<memory>');
    expect(result).toContain('Database is PostgreSQL 16');
    // The duplicate item in memory.md should be filtered out
    const memorySection = result.slice(result.indexOf('<memory>'));
    expect(memorySection).not.toContain('Always respond in Chinese');
  });

  it('skips MemoryStore entries when memory store is disabled or returns null', async () => {
    const memoryStore = new MemoryStore(mockAdapter);
    await memoryStore.add({
      category: 'Project Context',
      content: 'Database is PostgreSQL 16',
      source: 'user-explicit',
    });

    const injector = new HybridMindPromptInjector(mindStore, {
      getMemoryStore: () => memoryStore,
      isMemoryStoreEnabled: () => false,
    });

    const result = await injector.buildPromptInjection({});
    expect(result).not.toContain('<memory>');
    expect(result).not.toContain('Database is PostgreSQL 16');
  });

  it('injects untargeted project rules (no matchPatterns/tags) as project-wide fallback', async () => {
    // Rules added via /remember or pin-to-mind carry no targeting metadata.
    // They must still reach the prompt, otherwise those entry points produce inert rules.
    await mindStore.addDurable({
      category: 'user_preference',
      scope: 'project',
      state: 'active',
      content: 'Always format dates in ISO format',
      confidence: 0.95,
      tags: [],
    });

    const injector = new HybridMindPromptInjector(mindStore);
    const result = await injector.buildPromptInjection({ userPromptText: 'unrelated question' });

    expect(result).toContain('<project_context_rules>');
    expect(result).toContain('Always format dates in ISO format');
  });

  it('orders targeted rules before untargeted fallback even when the fallback is more confident', async () => {
    await mindStore.addDurable({
      category: 'user_preference',
      scope: 'project',
      state: 'active',
      content: 'Always format dates in ISO format',
      confidence: 0.98,
      tags: [],
    });
    await mindStore.addDurable({
      category: 'project_rule',
      scope: 'project',
      state: 'active',
      content: 'Provider contracts must not import features',
      confidence: 0.55,
      matchPatterns: ['src/providers/**'],
      tags: [],
    });

    const injector = new HybridMindPromptInjector(mindStore);
    const resolved = await injector.resolveInjection({
      activeFilePath: 'src/providers/acp/AcpSubprocess.ts',
    });

    const projectContents = resolved.recalledEntries
      .filter((entry) => entry.scope === 'project')
      .map((entry) => entry.content);

    expect(projectContents).toEqual([
      'Provider contracts must not import features',
      'Always format dates in ISO format',
    ]);
  });

  it('spends a tight project budget on the targeted rule, not the confident fallback', async () => {
    await mindStore.addDurable({
      category: 'user_preference',
      scope: 'project',
      state: 'active',
      content: 'Always format dates in ISO format and never localize numbers',
      confidence: 0.98,
      tags: [],
    });
    await mindStore.addDurable({
      category: 'project_rule',
      scope: 'project',
      state: 'active',
      content: 'Provider contracts must not import features',
      confidence: 0.55,
      matchPatterns: ['src/providers/**'],
      tags: [],
    });

    // Fits the targeted line only; the fallback line is longer than the budget.
    const injector = new HybridMindPromptInjector(mindStore, { maxProjectChars: 55 });
    const resolved = await injector.resolveInjection({
      activeFilePath: 'src/providers/acp/AcpSubprocess.ts',
    });

    expect(resolved.injectionText).toContain('Provider contracts must not import features');
    expect(resolved.injectionText).not.toContain('Always format dates in ISO format');
  });

  it('applies updateConfig at runtime for cached injector instances', async () => {
    await mindStore.addDurable({
      category: 'user_preference',
      scope: 'global',
      state: 'active',
      content: 'High confidence rule alpha with some detail',
      confidence: 0.95,
      tags: [],
    });
    await mindStore.addDurable({
      category: 'user_preference',
      scope: 'global',
      state: 'active',
      content: 'Lower confidence rule beta with some detail',
      confidence: 0.9,
      tags: [],
    });

    const injector = new HybridMindPromptInjector(mindStore, { maxGlobalChars: 500 });
    const before = await injector.buildPromptInjection({});
    expect(before).toContain('rule alpha');
    expect(before).toContain('rule beta');

    // The first (highest-confidence) line is always kept; a shrunk budget drops the rest.
    injector.updateConfig({ maxGlobalChars: 60 });
    const after = await injector.buildPromptInjection({});
    expect(after).toContain('rule alpha');
    expect(after).not.toContain('rule beta');
  });
});

