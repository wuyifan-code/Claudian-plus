/**
 * CachedVaultAdapter - opt-in read-through cache in front of the vault adapter.
 *
 * Only paths accepted by `shouldCache` are cached; every other path passes
 * straight through, so large hot subsystems such as the session metadata scan
 * keep their existing behaviour and memory profile. The memory subsystem is the
 * intended first consumer: prompt injection re-reads the memory file, the
 * awareness files and the mind stores on every turn.
 *
 * Writes are seeded into the cache rather than invalidating it (`write` knows
 * the exact content that landed on disk), which keeps a write-then-read turn
 * free of vault reads. `append` drops instead, because the concatenation the
 * base class performed is not visible here.
 */

import type { App } from 'obsidian';

import { VaultFileAdapter } from './VaultFileAdapter';

export interface CachedVaultAdapterOptions {
  /** Evaluated per operation, so callers can follow live settings. */
  shouldCache: (path: string) => boolean;
  /** Total cached text budget. A single larger entry is never cached. */
  maxBytes?: number;
  /** Maximum number of cached text entries. */
  maxEntries?: number;
}

export interface VaultContentCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  invalidations: number;
  evictions: number;
}

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_ENTRIES = 32;

/**
 * True when `path` is `root` or lives under it. Policies must accept the folder
 * itself as well as its contents, otherwise folder existence checks stay
 * uncached and keep reaching the vault.
 */
export function isPathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function ancestorFolders(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  const folders: string[] = [];
  // The last part is the file itself; every shorter prefix is a folder.
  for (let index = 1; index < parts.length; index += 1) {
    folders.push(parts.slice(0, index).join('/'));
  }
  return folders;
}

/** The folder itself plus every ancestor, innermost last. */
function folderChain(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  const folders: string[] = [];
  for (let index = 1; index <= parts.length; index += 1) {
    folders.push(parts.slice(0, index).join('/'));
  }
  return folders;
}

export class CachedVaultAdapter extends VaultFileAdapter {
  private readonly cachedText = new Map<string, string>();
  private readonly cachedExistence = new Map<string, boolean>();
  private readonly inFlightReads = new Map<string, Promise<string>>();
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private cachedBytes = 0;
  private counters = { hits: 0, misses: 0, invalidations: 0, evictions: 0 };

  constructor(app: App, private readonly options: CachedVaultAdapterOptions) {
    super(app);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get stats(): VaultContentCacheStats {
    return {
      entries: this.cachedText.size,
      bytes: this.cachedBytes,
      hits: this.counters.hits,
      misses: this.counters.misses,
      invalidations: this.counters.invalidations,
      evictions: this.counters.evictions,
    };
  }

  /** Drop one path (used by vault modify/create events). */
  invalidate(path: string): void {
    if (!this.cachedText.has(path) && !this.cachedExistence.has(path)) {
      return;
    }
    this.counters.invalidations += 1;
    this.dropEntry(path);
  }

  /** Drop a path and everything below it (used by delete/rename events). */
  invalidateSubtree(path: string): void {
    if (this.dropSubtree(path) > 0) {
      this.counters.invalidations += 1;
    }
  }

  invalidateAll(): void {
    this.counters.invalidations += 1;
    this.cachedText.clear();
    this.cachedExistence.clear();
    this.cachedBytes = 0;
  }

  override async exists(path: string): Promise<boolean> {
    // A known existence fact always answers, including facts derived from this
    // adapter's own successful mutations (a written file proves its folders).
    // The policy only decides what the cache is allowed to *learn*.
    const cached = this.cachedExistence.get(path);
    if (cached !== undefined) {
      this.counters.hits += 1;
      return cached;
    }

    if (!this.isCacheable(path)) {
      return super.exists(path);
    }

    this.counters.misses += 1;
    const exists = await super.exists(path);
    this.cachedExistence.set(path, exists);
    return exists;
  }

  override async read(path: string): Promise<string> {
    if (!this.isCacheable(path)) {
      return super.read(path);
    }

    const cached = this.cachedText.get(path);
    if (cached !== undefined) {
      this.counters.hits += 1;
      this.markRecentlyUsed(path);
      return cached;
    }

    const pending = this.inFlightReads.get(path);
    if (pending) {
      this.counters.hits += 1;
      return pending;
    }

    this.counters.misses += 1;
    const request = super.read(path).then(
      (content) => {
        this.inFlightReads.delete(path);
        this.rememberText(path, content);
        return content;
      },
      (error: unknown) => {
        this.inFlightReads.delete(path);
        throw error;
      },
    );
    this.inFlightReads.set(path, request);
    return request;
  }

  override async write(path: string, content: string): Promise<void> {
    await super.write(path, content);
    if (!this.isCacheable(path)) {
      return;
    }
    this.rememberText(path, content);
    this.rememberFolders(ancestorFolders(path));
  }

  override async append(path: string, content: string): Promise<void> {
    await super.append(path, content);
    this.invalidate(path);
  }

  override async delete(path: string): Promise<void> {
    await super.delete(path);
    this.invalidate(path);
  }

  override async deleteFolder(path: string): Promise<void> {
    await super.deleteFolder(path);
    this.invalidateSubtree(path);
  }

  override async removeFolderRecursive(path: string): Promise<void> {
    await super.removeFolderRecursive(path);
    this.invalidateSubtree(path);
  }

  override async rename(oldPath: string, newPath: string): Promise<void> {
    await super.rename(oldPath, newPath);
    // Descendants of either path may be cached even when the folder paths
    // themselves are not, so the drops are unconditional.
    this.invalidateSubtree(oldPath);
    this.dropSubtree(newPath);
    if (this.isCacheable(newPath)) {
      this.rememberFolders(ancestorFolders(newPath));
    }
  }

  override async ensureFolder(path: string): Promise<void> {
    await super.ensureFolder(path);
    if (this.isCacheable(path)) {
      this.rememberFolders(folderChain(path));
    }
  }

  private isCacheable(path: string): boolean {
    return path.length > 0 && this.options.shouldCache(path);
  }

  private rememberText(path: string, content: string): void {
    const bytes = Buffer.byteLength(content, 'utf8');
    this.dropEntry(path);
    if (bytes > this.maxBytes) {
      // Too large to be worth caching; the next read goes to the vault.
      return;
    }

    this.cachedText.set(path, content);
    this.cachedBytes += bytes;
    this.cachedExistence.set(path, true);
    this.evictOverflow();
  }

  /**
   * Records folders that a successful mutation proved to exist. Callers gate on
   * the mutated path being cacheable, so this stays bounded to the subtrees the
   * policy already covers plus their immediate parents.
   */
  private rememberFolders(paths: readonly string[]): void {
    for (const path of paths) {
      this.cachedExistence.set(path, true);
    }
  }

  private markRecentlyUsed(path: string): void {
    const content = this.cachedText.get(path);
    if (content === undefined) {
      return;
    }
    this.cachedText.delete(path);
    this.cachedText.set(path, content);
  }

  private dropEntry(path: string): void {
    const content = this.cachedText.get(path);
    if (content !== undefined) {
      this.cachedText.delete(path);
      this.cachedBytes -= Buffer.byteLength(content, 'utf8');
    }
    this.cachedExistence.delete(path);
  }

  /** Drops everything at or below `path`; returns how many entries were removed. */
  private dropSubtree(path: string): number {
    let dropped = 0;
    for (const key of [...this.cachedText.keys()]) {
      if (isPathWithin(key, path)) {
        this.dropEntry(key);
        dropped += 1;
      }
    }
    for (const key of [...this.cachedExistence.keys()]) {
      if (isPathWithin(key, path)) {
        this.cachedExistence.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  private evictOverflow(): void {
    while (
      this.cachedText.size > this.maxEntries
      || this.cachedBytes > this.maxBytes
    ) {
      const oldest = this.cachedText.keys().next();
      if (oldest.done) {
        return;
      }
      this.counters.evictions += 1;
      this.dropEntry(oldest.value);
    }
  }
}
