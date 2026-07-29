/**
 * VaultFileAdapter - Wrapper around Obsidian Vault API for file operations.
 *
 * Provides a consistent interface for file operations using Obsidian's
 * vault adapter instead of Node's fs module.
 */

import type { App } from 'obsidian';

function normalizeMutationPath(path: string): string {
  return path.replace(/\/+$/, '');
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right
    || left.startsWith(`${right}/`)
    || right.startsWith(`${left}/`);
}

export class VaultFileAdapter {
  private mutationQueues = new Map<string, Promise<void>>();
  private folderCreationPromises = new Map<string, Promise<void>>();

  constructor(private app: App) {}

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  async read(path: string): Promise<string> {
    return this.app.vault.adapter.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    await this.enqueueMutation([path], async () => {
      await this.ensureParentFolder(path);
      await this.app.vault.adapter.write(path, content);
    });
  }

  async append(path: string, content: string): Promise<void> {
    await this.enqueueMutation([path], async () => {
      await this.ensureParentFolder(path);
      if (await this.exists(path)) {
        const existing = await this.read(path);
        await this.app.vault.adapter.write(path, existing + content);
      } else {
        await this.app.vault.adapter.write(path, content);
      }
    });
  }

  async delete(path: string): Promise<void> {
    await this.enqueueMutation([path], async () => {
      if (await this.exists(path)) {
        await this.app.vault.adapter.remove(path);
      }
    });
  }

  /** Fails silently if non-empty or missing. */
  async deleteFolder(path: string): Promise<void> {
    await this.enqueueMutation([path], async () => {
      try {
        if (await this.exists(path)) {
          await this.app.vault.adapter.rmdir(path, false);
        }
      } catch {
        // Non-critical: directory may not be empty
      }
    });
  }

  /** Recursively removes a folder and all of its contents. */
  async removeFolderRecursive(path: string): Promise<void> {
    await this.enqueueMutation([path], async () => {
      if (await this.exists(path)) {
        await this.app.vault.adapter.rmdir(path, true);
      }
    });
  }

  async listFiles(folder: string): Promise<string[]> {
    if (!(await this.exists(folder))) {
      return [];
    }
    const listing = await this.app.vault.adapter.list(folder);
    return listing.files;
  }

  /** List subfolders in a folder. Returns relative paths from the folder. */
  async listFolders(folder: string): Promise<string[]> {
    if (!(await this.exists(folder))) {
      return [];
    }
    const listing = await this.app.vault.adapter.list(folder);
    return listing.folders;
  }

  /** Recursively list all files in a folder and subfolders. */
  async listFilesRecursive(folder: string): Promise<string[]> {
    const allFiles: string[] = [];

    const processFolder = async (currentFolder: string) => {
      if (!(await this.exists(currentFolder))) return;

      const listing = await this.app.vault.adapter.list(currentFolder);
      allFiles.push(...listing.files);

      for (const subfolder of listing.folders) {
        await processFolder(subfolder);
      }
    };

    await processFolder(folder);
    return allFiles;
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const folder = filePath.substring(0, filePath.lastIndexOf('/'));
    if (folder && !(await this.exists(folder))) {
      // The caller already holds the child-file mutation slot. Acquiring the
      // parent folder slot here would wait on that same child slot and deadlock.
      await this.ensureFolderUnchecked(folder);
    }
  }

  /** Ensure a folder exists, creating it and parent folders if needed. */
  async ensureFolder(path: string): Promise<void> {
    await this.enqueueMutation([path], () => this.ensureFolderUnchecked(path));
  }

  private async ensureFolderUnchecked(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      await this.ensureSingleFolder(current);
    }
  }

  private async ensureSingleFolder(path: string): Promise<void> {
    const existing = this.folderCreationPromises.get(path);
    if (existing) {
      await existing;
      return;
    }
    if (await this.exists(path)) return;

    const pendingAfterCheck = this.folderCreationPromises.get(path);
    if (pendingAfterCheck) {
      await pendingAfterCheck;
      return;
    }

    const creation = (async () => {
      try {
        await this.app.vault.adapter.mkdir(path);
      } catch (error) {
        if (!(await this.exists(path))) {
          throw error;
        }
      }
    })();
    this.folderCreationPromises.set(path, creation);
    try {
      await creation;
    } finally {
      if (this.folderCreationPromises.get(path) === creation) {
        this.folderCreationPromises.delete(path);
      }
    }
  }

  /** Rename/move a file. */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.enqueueMutation(
      [oldPath, newPath],
      () => this.app.vault.adapter.rename(oldPath, newPath),
    );
  }

  /**
   * Serializes overlapping vault mutations. A metadata save started before a
   * delete of that file (or its parent folder) must finish first, otherwise a
   * slow write can recreate a directory that was already removed. Unrelated
   * files keep making progress in parallel so one slow memory write does not
   * delay a conversation save.
   */
  private enqueueMutation(
    paths: readonly string[],
    operation: () => Promise<void>,
  ): Promise<void> {
    const keys = [...new Set(paths.map(normalizeMutationPath).filter(Boolean))].sort();
    const priorTails = new Set<Promise<void>>();
    for (const [queuedPath, tail] of this.mutationQueues) {
      if (keys.some(path => pathsOverlap(path, queuedPath))) {
        priorTails.add(tail);
      }
    }
    const queued = Promise.all(priorTails).then(operation);
    // Keep later mutations available after a transient storage failure while
    // preserving the error for the caller that initiated the failed action.
    const tail = queued.catch(() => undefined);
    for (const path of keys) {
      this.mutationQueues.set(path, tail);
    }
    void tail.finally(() => {
      for (const path of keys) {
        if (this.mutationQueues.get(path) === tail) {
          this.mutationQueues.delete(path);
        }
      }
    }).catch(() => undefined);
    return queued;
  }

  async stat(path: string): Promise<{ mtime: number; size: number } | null> {
    try {
      const stat = await this.app.vault.adapter.stat(path);
      if (!stat) return null;
      return { mtime: stat.mtime, size: stat.size };
    } catch {
      return null;
    }
  }
}
