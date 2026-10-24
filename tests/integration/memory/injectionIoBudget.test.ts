/**
 * Per-turn injection vault I/O budget (V2 stack).
 *
 * Since the V1 injector retirement, provider runtimes build their system
 * prompt appendix from the V2 MemoryRetriever — which reads the home-directory
 * repository, not the vault — plus the ConsciousnessEngine awareness files.
 * This suite pins how many operations the remaining vault-side reads cost:
 * the read-side operation count is engine independent and is therefore the
 * primary signal (see `.context/notes/long-thread-baseline.md`).
 *
 * The stack is assembled exactly like `ClaudianPlusPlugin` does it, over a
 * counting vault double, so the numbers below are the operations that reach
 * the Obsidian vault adapter.
 */

import { type CountingVault, createCountingVault } from '@test/helpers/countingVault';

import { SOUL_FILE, USER_FILE } from '@/core/memory/consciousness-types';
import { ConsciousnessEngine } from '@/core/memory/ConsciousnessEngine';
import { createMemoryCachePolicy } from '@/core/memory/memoryCachePolicy';
import { DEFAULT_MEMORY_FILE_PATH } from '@/core/memory/types';
import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { MemoryRetriever } from '@/core/memory/v2/MemoryRetriever';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';
import { CachedVaultAdapter } from '@/core/storage/CachedVaultAdapter';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

/**
 * Ratchet for the cold turn (the one that still has to reach the vault).
 * The legacy three-layer injector cost 12 ops; the V2 stack reads only the
 * awareness files, so the ceiling drops accordingly.
 */
const COLD_INJECTION_IO_OPS_BASELINE = 8;

/** Steady-state budget: a warm turn must not touch the vault at all. */
const WARM_INJECTION_IO_OPS_BUDGET = 0;

const SOUL_TEXT = '# 协作风格\n\n- 语言：跟随用户语言';
const USER_TEXT = '# 用户画像\n\n## 偏好\n\n- 喜欢直接给结论';

const FIXTURE_FILES: Record<string, string> = {
  [SOUL_FILE]: SOUL_TEXT,
  [USER_FILE]: USER_TEXT,
  [DEFAULT_MEMORY_FILE_PATH]: '# Claudian Plus Memory\n\n- exported view\n',
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
  consciousness: ConsciousnessEngine;
  retriever: MemoryRetriever;
}

async function createInjectionStack(adapter: VaultFileAdapter): Promise<InjectionStack> {
  const repository = new MemoryRepository({
    storage: new InMemoryMemoryStorageAdapter(),
    vaultId: 'test-vault',
  });
  await repository.initialize();
  return {
    consciousness: new ConsciousnessEngine(adapter),
    retriever: new MemoryRetriever({ repository }),
  };
}

/**
 * Mirrors the provider runtimes: retrieval and consciousness injections are
 * requested in parallel and awaited before the turn is sent. The V2 retriever
 * runs on the home-directory repository and must never touch the vault.
 */
async function runInjectionTurn(stack: InjectionStack): Promise<string> {
  const [memoryText, consciousnessText] = await Promise.all([
    stack.retriever.retrieveContext({
      vaultId: 'test-vault',
      userPrompt: 'help me with the build',
      activeFilePaths: [],
      now: Date.now(),
      maxTokens: 1200,
    }).then((packet) => packet.text),
    stack.consciousness.buildConsciousnessInjection(),
  ]);

  return [memoryText, consciousnessText].filter(Boolean).join('\n\n');
}

describe('per-turn injection vault I/O budget (V2 stack)', () => {
  it('pays the vault once on a cold turn and nothing on warm turns', async () => {
    const vault = createCountingVault(FIXTURE_FILES);
    const stack = await createInjectionStack(createMemoryAdapter(vault));

    const text = await runInjectionTurn(stack);
    const coldOps = vault.readOps();

    expect(text).toContain('跟随用户语言');
    expect(coldOps).toBeLessThanOrEqual(COLD_INJECTION_IO_OPS_BASELINE);

    vault.reset();
    for (let turn = 0; turn < 5; turn += 1) {
      await runInjectionTurn(stack);
    }

    expect(vault.readOps()).toBe(WARM_INJECTION_IO_OPS_BUDGET);
    expect(vault.perPath).toEqual({});
  });

  it('produces identical consciousness injection text on every turn', async () => {
    const vault = createCountingVault(FIXTURE_FILES);
    const stack = await createInjectionStack(createMemoryAdapter(vault));

    const first = await runInjectionTurn(stack);
    const second = await runInjectionTurn(stack);

    expect(second).toBe(first);
  });

  it('serves a later turn from the vault after an external awareness edit', async () => {
    const vault = createCountingVault(FIXTURE_FILES);
    const cache = createMemoryAdapter(vault);
    const stack = await createInjectionStack(cache);

    const before = await runInjectionTurn(stack);
    expect(before).toContain('跟随用户语言');

    vault.files[SOUL_FILE] = '# 协作风格\n\n- Language: English only\n';
    cache.invalidate(SOUL_FILE);

    const after = await runInjectionTurn(stack);
    expect(after).toContain('English only');
    expect(after).not.toContain('跟随用户语言');
  });
});
