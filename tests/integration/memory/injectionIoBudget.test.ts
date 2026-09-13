/**
 * Per-turn injection vault I/O budget.
 *
 * Every provider runtime awaits `getMemoryInjectionText()` and
 * `getConsciousnessInjectionText()` before a turn starts, and those read the
 * memory file, the awareness files and the mind stores from the vault. This
 * suite pins how many operations that costs, in the same spirit as the startup
 * and bundle budgets: the read-side operation count is engine independent and
 * is therefore the primary signal (see `.context/notes/long-thread-baseline.md`).
 *
 * The stack is assembled exactly like `ClaudianPlusPlugin` does it, over a
 * counting vault double, so the numbers below are the operations that reach the
 * Obsidian vault adapter.
 */

import { type CountingVault,createCountingVault } from '@test/helpers/countingVault';

import { SOUL_FILE, USER_FILE } from '@/core/memory/consciousness-types';
import { ConsciousnessEngine } from '@/core/memory/ConsciousnessEngine';
import { HybridMindPromptInjector } from '@/core/memory/HybridMindPromptInjector';
import { createMemoryCachePolicy } from '@/core/memory/memoryCachePolicy';
import { MemoryStore } from '@/core/memory/MemoryStore';
import type { DurableMindEntry } from '@/core/memory/mind-types';
import { GLOBAL_PROFILE_FILE, MindStore, PROJECT_RULES_FILE } from '@/core/memory/MindStore';
import { DEFAULT_MEMORY_FILE_PATH } from '@/core/memory/types';
import { CachedVaultAdapter } from '@/core/storage/CachedVaultAdapter';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

/**
 * Ratchet for the cold turn (the one that still has to reach the vault).
 * Recorded from the implementation, then only ever lowered. Raising it requires
 * a deliberate edit with a reason in the commit message.
 *
 * The pass-through adapter cost 17; caching removed the re-read that
 * `recordHit`'s usage write used to perform, leaving one pair per source.
 */
const COLD_INJECTION_IO_OPS_BASELINE = 12;

/** Steady-state budget: a warm turn must not touch the vault at all. */
const WARM_INJECTION_IO_OPS_BUDGET = 0;

/** Exact read-side cost of one cold turn, per source. Recorded from a measured run. */
const COLD_TURN_PATH_BREAKDOWN: Record<string, { exists: number; read: number }> = {
  '.claudian-plus': { exists: 1, read: 0 },
  '.claudian-plus/awareness': { exists: 1, read: 0 },
  '.claudian-plus/awareness/SOUL.md': { exists: 1, read: 1 },
  '.claudian-plus/awareness/USER.md': { exists: 1, read: 1 },
  '.claudian-plus/awareness/global-profile.json': { exists: 1, read: 1 },
  '.claudian-plus/awareness/project-rules.json': { exists: 1, read: 1 },
  '.claudian-plus/memory.md': { exists: 1, read: 1 },
};

const MEMORY_ENTRY_TEXT = 'Prefers Chinese communication';
const GLOBAL_MIND_TEXT = 'Always reply in Chinese.';
const PROJECT_MIND_TEXT = 'Providers must stay independent from features.';
const SOUL_TEXT = '# 协作风格\n\n- 语言：跟随用户语言';
const USER_TEXT = '# 用户画像\n\n## 偏好\n\n- 喜欢直接给结论';

function createDurableEntry(overrides: Partial<DurableMindEntry>): DurableMindEntry {
  return {
    id: 'mind_entry',
    category: 'user_preference',
    scope: 'global',
    state: 'active',
    content: 'placeholder',
    confidence: 0.8,
    lastUsedAt: 0,
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    ...overrides,
  };
}

const FIXTURE_FILES: Record<string, string> = {
  [DEFAULT_MEMORY_FILE_PATH]: `# ClaudianPlus Memory\n\n## User Preferences\n- ${MEMORY_ENTRY_TEXT}\n`,
  [SOUL_FILE]: SOUL_TEXT,
  [USER_FILE]: USER_TEXT,
  [GLOBAL_PROFILE_FILE]: JSON.stringify({
    version: 1,
    entries: [createDurableEntry({ id: 'mind_global', content: GLOBAL_MIND_TEXT })],
  }),
  [PROJECT_RULES_FILE]: JSON.stringify({
    version: 1,
    entries: [
      createDurableEntry({
        id: 'mind_project',
        category: 'project_rule',
        scope: 'project',
        content: PROJECT_MIND_TEXT,
        matchPatterns: ['src/**'],
      }),
    ],
  }),
};

/** The production wiring: the shared adapter wrapped in the memory read cache. */
function createMemoryAdapter(vault: CountingVault): CachedVaultAdapter {
  return new CachedVaultAdapter(vault.app, {
    shouldCache: createMemoryCachePolicy({
      getMemoryFilePath: () => DEFAULT_MEMORY_FILE_PATH,
    }),
  });
}

interface InjectionStack {
  memoryStore: MemoryStore;
  mindStore: MindStore;
  injector: HybridMindPromptInjector;
  consciousness: ConsciousnessEngine;
}

function createInjectionStack(adapter: VaultFileAdapter): InjectionStack {
  // Annotated because the two stores reference each other's provider lazily.
  const mindStore: MindStore = new MindStore(adapter, {
    getMemoryStore: (): MemoryStore | null => memoryStore,
  });
  const memoryStore: MemoryStore = new MemoryStore(adapter, {
    filePath: DEFAULT_MEMORY_FILE_PATH,
    getMindStore: (): MindStore | null => mindStore,
  });
  const injector = new HybridMindPromptInjector(mindStore, {
    getMemoryStore: () => memoryStore,
    isMemoryStoreEnabled: () => true,
  });
  const consciousness = new ConsciousnessEngine(adapter);

  return { memoryStore, mindStore, injector, consciousness };
}

/**
 * Mirrors the provider runtimes: both injections are requested in parallel and
 * are awaited before the turn is sent.
 *
 * `HybridMindPromptInjector` also fires `mindStore.recordHit()` without
 * awaiting it (`HybridMindPromptInjector.ts:168`). Counting a turn is only
 * deterministic once those usage writes have settled, so the runner drains them.
 */
async function runInjectionTurn(
  stack: InjectionStack,
  pendingUsageWrites: Array<Promise<unknown>>,
  activeFilePath = 'src/main.ts',
): Promise<string> {
  const [memoryText, consciousnessText] = await Promise.all([
    stack.injector.buildPromptInjection({ activeFilePath }),
    stack.consciousness.buildConsciousnessInjection(),
  ]);
  await Promise.allSettled(pendingUsageWrites.splice(0));

  return [memoryText, consciousnessText].filter(Boolean).join('\n\n');
}

/** Captures the fire-and-forget `recordHit` promises so a turn can be drained. */
function trackUsageWrites(mindStore: MindStore): Array<Promise<unknown>> {
  const pending: Array<Promise<unknown>> = [];
  const original = mindStore.recordHit.bind(mindStore);
  jest.spyOn(mindStore, 'recordHit').mockImplementation((id: string) => {
    const promise = original(id);
    pending.push(promise);
    return promise;
  });
  return pending;
}

function ioSnapshot(vault: CountingVault): { totalReadOps: number; perPath: Record<string, unknown> } {
  return { totalReadOps: vault.readOps(), perPath: vault.perPath };
}

describe('per-turn injection vault I/O budget', () => {
  it('pays the vault once on a cold turn and nothing on warm turns', async () => {
    const vault = createCountingVault(FIXTURE_FILES);
    const stack = createInjectionStack(createMemoryAdapter(vault));
    const usageWrites = trackUsageWrites(stack.mindStore);

    const text = await runInjectionTurn(stack, usageWrites);
    const coldOps = vault.readOps();

    expect(text).toContain(MEMORY_ENTRY_TEXT);
    expect(text).toContain(GLOBAL_MIND_TEXT);
    expect(text).toContain(PROJECT_MIND_TEXT);
    expect(coldOps).toBeLessThanOrEqual(COLD_INJECTION_IO_OPS_BASELINE);

    vault.reset();
    for (let turn = 0; turn < 5; turn += 1) {
      await runInjectionTurn(stack, usageWrites);
    }

    expect(ioSnapshot(vault)).toEqual({
      totalReadOps: WARM_INJECTION_IO_OPS_BUDGET,
      perPath: {},
    });
  });

  it('reads each memory source at most once per cold turn', async () => {
    const vault = createCountingVault(FIXTURE_FILES);
    const stack = createInjectionStack(createMemoryAdapter(vault));
    const usageWrites = trackUsageWrites(stack.mindStore);

    await runInjectionTurn(stack, usageWrites);

    expect(vault.perPath).toEqual(COLD_TURN_PATH_BREAKDOWN);
  });

  it('produces identical injection text on every turn', async () => {
    const vault = createCountingVault(FIXTURE_FILES);
    const stack = createInjectionStack(createMemoryAdapter(vault));
    const usageWrites = trackUsageWrites(stack.mindStore);

    const first = await runInjectionTurn(stack, usageWrites);
    const second = await runInjectionTurn(stack, usageWrites);
    const third = await runInjectionTurn(stack, usageWrites);

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('records usage once per turn, as a read-modify-write of the mind store', async () => {
    const vault = createCountingVault(FIXTURE_FILES);
    const stack = createInjectionStack(createMemoryAdapter(vault));
    const usageWrites = trackUsageWrites(stack.mindStore);

    await runInjectionTurn(stack, usageWrites);

    // One matched project rule => one durable write. The usage write is the only
    // vault write a steady-state turn performs; the read side must stay at zero.
    expect(vault.counts.write).toBe(1);
  });

  it('serves a later turn from the vault after an external memory edit', async () => {
    const vault = createCountingVault(FIXTURE_FILES);
    const cache = createMemoryAdapter(vault);
    const stack = createInjectionStack(cache);
    const usageWrites = trackUsageWrites(stack.mindStore);

    const before = await runInjectionTurn(stack, usageWrites);
    expect(before).toContain(MEMORY_ENTRY_TEXT);

    vault.files[DEFAULT_MEMORY_FILE_PATH] =
      '# ClaudianPlus Memory\n\n## User Preferences\n- Switched to English\n';
    cache.invalidate(DEFAULT_MEMORY_FILE_PATH);

    const after = await runInjectionTurn(stack, usageWrites);
    expect(after).toContain('Switched to English');
    expect(after).not.toContain(MEMORY_ENTRY_TEXT);
  });

  it('keeps the cache bounded across many warm turns', async () => {
    const vault = createCountingVault(FIXTURE_FILES);
    const cache = createMemoryAdapter(vault);
    const stack = createInjectionStack(cache);
    const usageWrites = trackUsageWrites(stack.mindStore);

    for (let turn = 0; turn < 100; turn += 1) {
      await runInjectionTurn(stack, usageWrites);
    }

    expect(cache.stats.entries).toBeLessThanOrEqual(8);
    expect(cache.stats.bytes).toBeLessThanOrEqual(512 * 1024);
  });
});
