import { HybridMindPromptInjector } from '@/core/memory/HybridMindPromptInjector';
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
    const updated = (await mindStore.listDurable()).find((e) => e.id === created.id);
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
});
