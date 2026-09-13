/**
 * Counting Obsidian vault double for I/O budget tests.
 *
 * Counts every operation that reaches the underlying vault adapter, which is the
 * metric the per-turn injection budget is expressed in: behind a pass-through
 * adapter one store call costs one operation, behind a cached adapter only
 * misses reach the adapter. Counting at this level keeps the number comparable
 * before and after caching is introduced.
 */

import type { App } from 'obsidian';

export interface VaultIoCounts {
  exists: number;
  read: number;
  write: number;
  remove: number;
  rename: number;
  list: number;
  mkdir: number;
  rmdir: number;
  stat: number;
}

export interface VaultPathCounts {
  exists: number;
  read: number;
}

export interface CountingVault {
  app: App;
  /** Mutable backing store; tests may write here to simulate external edits. */
  files: Record<string, string>;
  counts: VaultIoCounts;
  /** Read-side operations per path, for failure diagnostics. */
  perPath: Record<string, VaultPathCounts>;
  /** Read-side operations: the ones the per-turn injection budget is measured in. */
  readOps(): number;
  /** Every counted adapter operation. */
  totalOps(): number;
  /** Reset counters only; the backing store is preserved. */
  reset(): void;
}

export function createCountingVault(files: Record<string, string> = {}): CountingVault {
  const store: Record<string, string> = { ...files };
  const counts: VaultIoCounts = {
    exists: 0,
    read: 0,
    write: 0,
    remove: 0,
    rename: 0,
    list: 0,
    mkdir: 0,
    rmdir: 0,
    stat: 0,
  };
  const perPath: Record<string, VaultPathCounts> = {};

  const recordPath = (path: string, operation: keyof VaultPathCounts): void => {
    perPath[path] = perPath[path] ?? { exists: 0, read: 0 };
    perPath[path][operation] += 1;
  };

  const adapter = {
    async exists(path: string): Promise<boolean> {
      counts.exists += 1;
      recordPath(path, 'exists');
      // Folders are implied by their contents, like a real vault adapter.
      return path in store || Object.keys(store).some(key => key.startsWith(`${path}/`));
    },
    async read(path: string): Promise<string> {
      counts.read += 1;
      recordPath(path, 'read');
      if (!(path in store)) {
        throw new Error(`File not found: ${path}`);
      }
      return store[path];
    },
    async write(path: string, content: string): Promise<void> {
      counts.write += 1;
      store[path] = content;
    },
    async append(path: string, content: string): Promise<void> {
      counts.write += 1;
      store[path] = (store[path] ?? '') + content;
    },
    async remove(path: string): Promise<void> {
      counts.remove += 1;
      delete store[path];
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      counts.rename += 1;
      store[newPath] = store[oldPath];
      delete store[oldPath];
    },
    async list(folder: string): Promise<{ files: string[]; folders: string[] }> {
      counts.list += 1;
      const prefix = folder.endsWith('/') ? folder : `${folder}/`;
      const listedFiles = Object.keys(store).filter(path => path.startsWith(prefix));
      const folders = new Set<string>();
      for (const path of listedFiles) {
        const rest = path.slice(prefix.length);
        const separator = rest.indexOf('/');
        if (separator >= 0) {
          folders.add(`${folder}/${rest.slice(0, separator)}`);
        }
      }
      return { files: listedFiles, folders: [...folders] };
    },
    async mkdir(path: string): Promise<void> {
      counts.mkdir += 1;
      void path;
    },
    async rmdir(path: string): Promise<void> {
      counts.rmdir += 1;
      void path;
    },
    async stat(path: string): Promise<{ mtime: number; size: number } | null> {
      counts.stat += 1;
      return path in store ? { mtime: 0, size: store[path].length } : null;
    },
  };

  const app = {
    vault: {
      configDir: '.obsidian',
      adapter,
    },
  } as unknown as App;

  return {
    app,
    files: store,
    counts,
    perPath,
    readOps: () => counts.exists + counts.read,
    totalOps: () => Object.values(counts).reduce((sum, value) => sum + value, 0),
    reset: () => {
      for (const key of Object.keys(counts) as Array<keyof VaultIoCounts>) {
        counts[key] = 0;
      }
      for (const key of Object.keys(perPath)) {
        delete perPath[key];
      }
    },
  };
}
