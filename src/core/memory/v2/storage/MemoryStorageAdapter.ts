import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface IMemoryStorageAdapter {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  writeFileAtomic(filePath: string, content: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  deleteFile(filePath: string): Promise<void>;
  listFiles(dirPath: string): Promise<string[]>;
  mkdir(dirPath: string): Promise<void>;
  acquireLock(lockName: string, ttlMs?: number): Promise<string | null>;
  releaseLock(lockName: string, token: string): Promise<boolean>;
}

export class InMemoryMemoryStorageAdapter implements IMemoryStorageAdapter {
  private files = new Map<string, string>();
  private locks = new Map<string, { token: string; expiresAt: number }>();

  async readFile(filePath: string): Promise<string> {
    const normalized = this.normalize(filePath);
    const content = this.files.get(normalized);
    if (content === undefined) {
      throw new Error(`File not found: ${filePath}`);
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const normalized = this.normalize(filePath);
    this.files.set(normalized, content);
  }

  async writeFileAtomic(filePath: string, content: string): Promise<void> {
    await this.writeFile(filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    const normalized = this.normalize(filePath);
    return this.files.has(normalized);
  }

  async deleteFile(filePath: string): Promise<void> {
    const normalized = this.normalize(filePath);
    this.files.delete(normalized);
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const normalizedDir = this.normalize(dirPath).replace(/\/+$/, '') + '/';
    const results: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(normalizedDir)) {
        const sub = key.slice(normalizedDir.length);
        const firstSeg = sub.split('/')[0];
        if (!results.includes(firstSeg)) {
          results.push(firstSeg);
        }
      }
    }
    return results;
  }

  async mkdir(_dirPath: string): Promise<void> {
    // In-memory has no strict directories
  }

  async acquireLock(lockName: string, ttlMs: number = 10_000): Promise<string | null> {
    const now = Date.now();
    const existing = this.locks.get(lockName);
    if (existing && existing.expiresAt > now) {
      return null;
    }
    const token = `lock_${now}_${Math.random().toString(36).slice(2, 8)}`;
    this.locks.set(lockName, { token, expiresAt: now + ttlMs });
    return token;
  }

  async releaseLock(lockName: string, token: string): Promise<boolean> {
    const existing = this.locks.get(lockName);
    if (existing && existing.token === token) {
      this.locks.delete(lockName);
      return true;
    }
    return false;
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+/g, '/');
  }
}

export class FsMemoryStorageAdapter implements IMemoryStorageAdapter {
  constructor(private basePath: string = '') {}

  private resolvePath(targetPath: string): string {
    if (path.isAbsolute(targetPath)) {
      return targetPath;
    }
    return path.join(this.basePath, targetPath);
  }

  async readFile(filePath: string): Promise<string> {
    const full = this.resolvePath(filePath);
    return await fs.readFile(full, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const full = this.resolvePath(filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  async writeFileAtomic(filePath: string, content: string): Promise<void> {
    const full = this.resolvePath(filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    await fs.writeFile(tmp, content, 'utf-8');
    try {
      await fs.rename(tmp, full);
    } catch {
      // Windows rename may fail if target exists in some circumstances, retry with copy + unlink
      try {
        await fs.copyFile(tmp, full);
        await fs.unlink(tmp);
      } catch (copyErr) {
        try {
          await fs.unlink(tmp);
        } catch {
          // ignore cleanup error
        }
        throw copyErr;
      }
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const full = this.resolvePath(filePath);
    try {
      await fs.access(full);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const full = this.resolvePath(filePath);
    try {
      await fs.unlink(full);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const full = this.resolvePath(dirPath);
    try {
      const entries = await fs.readdir(full);
      return entries;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    const full = this.resolvePath(dirPath);
    await fs.mkdir(full, { recursive: true });
  }

  async acquireLock(lockName: string, ttlMs: number = 10_000): Promise<string | null> {
    const lockFile = this.resolvePath(`${lockName}.lock`);
    await fs.mkdir(path.dirname(lockFile), { recursive: true });
    const now = Date.now();
    const token = `token_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = JSON.stringify({ token, expiresAt: now + ttlMs });

    try {
      // wx: open for writing, failing if path exists
      await fs.writeFile(lockFile, payload, { flag: 'wx' });
      return token;
    } catch {
      // File exists, check if stale/expired
      try {
        const content = await fs.readFile(lockFile, 'utf-8');
        const parsed = JSON.parse(content) as { expiresAt?: number };
        if (typeof parsed.expiresAt === 'number' && parsed.expiresAt < now) {
          // Lock is stale, attempt to overwrite atomically
          await fs.writeFile(lockFile, payload, 'utf-8');
          return token;
        }
      } catch {
        // Corrupt lock file, overwrite
        try {
          await fs.writeFile(lockFile, payload, 'utf-8');
          return token;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  async releaseLock(lockName: string, token: string): Promise<boolean> {
    const lockFile = this.resolvePath(`${lockName}.lock`);
    try {
      const content = await fs.readFile(lockFile, 'utf-8');
      const parsed = JSON.parse(content) as { token?: string };
      if (parsed.token === token) {
        await fs.unlink(lockFile);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
