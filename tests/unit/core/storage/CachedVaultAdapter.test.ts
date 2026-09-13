import { type CountingVault,createCountingVault } from '@test/helpers/countingVault';

import { CachedVaultAdapter, isPathWithin } from '@/core/storage/CachedVaultAdapter';

describe('CachedVaultAdapter', () => {
  let vault: CountingVault;
  let adapter: CachedVaultAdapter;

  const CACHED = 'cache/memory.md';
  const OTHER = 'sessions/one.meta.json';
  const shouldCache = (path: string): boolean => isPathWithin(path, 'cache');

  beforeEach(() => {
    vault = createCountingVault({
      [CACHED]: 'first',
      [OTHER]: 'session',
      'cache/nested/deep.md': 'deep',
      'cache/a.md': 'a',
      'cache/b.md': 'b',
      'cache/c.md': 'c',
    });
    adapter = new CachedVaultAdapter(vault.app, { shouldCache });
  });

  describe('path policy', () => {
    it('passes non-cacheable paths straight through', async () => {
      await adapter.read(OTHER);
      await adapter.read(OTHER);
      await adapter.exists(OTHER);
      await adapter.exists(OTHER);

      expect(vault.counts.read).toBe(2);
      expect(vault.counts.exists).toBe(2);
      expect(adapter.stats.entries).toBe(0);
      expect(adapter.stats.hits).toBe(0);
    });

    it('caches cacheable paths', async () => {
      await adapter.read(CACHED);
      await adapter.read(CACHED);

      expect(vault.counts.read).toBe(1);
      expect(adapter.stats).toMatchObject({ entries: 1, hits: 1, misses: 1 });
    });
  });

  describe('exists', () => {
    it('serves a cached hit without touching the vault', async () => {
      await adapter.exists(CACHED);
      const result = await adapter.exists(CACHED);

      expect(result).toBe(true);
      expect(vault.counts.exists).toBe(1);
    });

    it('caches misses', async () => {
      await adapter.exists('cache/missing.md');
      const result = await adapter.exists('cache/missing.md');

      expect(result).toBe(false);
      expect(vault.counts.exists).toBe(1);
    });
  });

  describe('read', () => {
    it('returns the vault content on a miss and the cached content afterwards', async () => {
      await expect(adapter.read(CACHED)).resolves.toBe('first');
      await expect(adapter.read(CACHED)).resolves.toBe('first');

      expect(vault.counts.read).toBe(1);
    });

    it('coalesces concurrent reads into one vault operation', async () => {
      const results = await Promise.all([
        adapter.read(CACHED),
        adapter.read(CACHED),
        adapter.read(CACHED),
      ]);

      expect(results).toEqual(['first', 'first', 'first']);
      expect(vault.counts.read).toBe(1);
    });

    it('does not cache read failures', async () => {
      await expect(adapter.read('cache/missing.md')).rejects.toThrow('File not found');
      await expect(adapter.read('cache/missing.md')).rejects.toThrow('File not found');

      expect(vault.counts.read).toBe(2);
      expect(adapter.stats.entries).toBe(0);
    });

    it('marks a successfully read file as existing', async () => {
      await adapter.read(CACHED);
      await adapter.exists(CACHED);

      expect(vault.counts.exists).toBe(0);
    });
  });

  describe('own writes', () => {
    it('seeds the cache so a write-then-read costs nothing', async () => {
      await adapter.write(CACHED, 'written');
      const content = await adapter.read(CACHED);

      expect(content).toBe('written');
      expect(vault.counts.read).toBe(0);
      expect(adapter.stats.hits).toBe(1);
    });

    it('seeds parent folders so a later folder check is free', async () => {
      await adapter.write('cache/nested/deep.md', 'updated');
      vault.reset();

      await adapter.exists('cache');
      await adapter.exists('cache/nested');

      expect(vault.counts.exists).toBe(0);
    });

    it('drops the entry on append instead of guessing the concatenation', async () => {
      await adapter.read(CACHED);
      await adapter.append(CACHED, ' second');

      const content = await adapter.read(CACHED);

      expect(content).toBe('first second');
      expect(vault.counts.read).toBe(2);
    });

    it('drops the entry on delete', async () => {
      await adapter.read(CACHED);
      await adapter.delete(CACHED);
      const exists = await adapter.exists(CACHED);

      expect(exists).toBe(false);
      expect(vault.counts.exists).toBe(1);
    });

    it('drops a whole subtree when a folder is removed', async () => {
      await adapter.read(CACHED);
      await adapter.read('cache/nested/deep.md');
      await adapter.removeFolderRecursive('cache');

      expect(adapter.stats.entries).toBe(0);
    });

    it('forgets both paths on rename', async () => {
      await adapter.read(CACHED);
      await adapter.rename(CACHED, 'cache/renamed.md');
      const content = await adapter.read('cache/renamed.md');

      expect(content).toBe('first');
      expect(vault.counts.read).toBe(2);
    });

    it('marks an ensured folder as existing', async () => {
      await adapter.ensureFolder('cache/nested');
      vault.reset();

      await expect(adapter.exists('cache/nested')).resolves.toBe(true);
      expect(vault.counts.exists).toBe(0);
    });

    it('remembers ancestor folders proved by its own writes, even outside the policy', async () => {
      vault.files['outer/inner/file.md'] = 'x';
      const scoped = new CachedVaultAdapter(vault.app, {
        shouldCache: path => isPathWithin(path, 'outer/inner'),
      });

      await scoped.write('outer/inner/file.md', 'x');
      vault.reset();

      // `outer` is not covered by the policy, but the successful write proved it
      // exists, so the folder check does not need to reach the vault.
      await expect(scoped.exists('outer')).resolves.toBe(true);
      expect(vault.counts.exists).toBe(0);
    });

    it('does not record misses for paths outside the policy', async () => {
      await adapter.exists('sessions/one.meta.json');
      await adapter.exists('sessions/one.meta.json');

      expect(vault.counts.exists).toBe(2);
    });
  });

  describe('external invalidation', () => {
    it('re-reads a path after invalidate', async () => {
      await adapter.read(CACHED);
      vault.files[CACHED] = 'edited outside';
      adapter.invalidate(CACHED);

      await expect(adapter.read(CACHED)).resolves.toBe('edited outside');
      expect(vault.counts.read).toBe(2);
    });

    it('does not touch the vault when invalidating an uncached path', async () => {
      adapter.invalidate('cache/never-read.md');

      expect(adapter.stats.invalidations).toBe(0);
    });

    it('drops descendants on invalidateSubtree', async () => {
      await adapter.read('cache/nested/deep.md');
      adapter.invalidateSubtree('cache');

      expect(adapter.stats.entries).toBe(0);
    });

    it('clears everything on invalidateAll', async () => {
      await adapter.read(CACHED);
      await adapter.exists(CACHED);
      adapter.invalidateAll();

      expect(adapter.stats).toMatchObject({ entries: 0, bytes: 0 });
      await adapter.read(CACHED);
      expect(vault.counts.read).toBe(2);
    });
  });

  describe('bounds', () => {
    it('never caches an entry larger than the budget', async () => {
      const tiny = new CachedVaultAdapter(vault.app, { shouldCache, maxBytes: 4 });

      await tiny.read(CACHED);
      await tiny.read(CACHED);

      expect(vault.counts.read).toBe(2);
      expect(tiny.stats.entries).toBe(0);
    });

    it('evicts the least recently used entry', async () => {
      const bounded = new CachedVaultAdapter(vault.app, { shouldCache, maxEntries: 2 });
      await bounded.read('cache/a.md');
      await bounded.read('cache/b.md');
      await bounded.read('cache/a.md');
      await bounded.read('cache/c.md');
      vault.reset();

      await bounded.read('cache/a.md');
      expect(vault.counts.read).toBe(0);

      await bounded.read('cache/b.md');
      expect(vault.counts.read).toBe(1);
      expect(bounded.stats.evictions).toBe(2);
    });
  });
});
