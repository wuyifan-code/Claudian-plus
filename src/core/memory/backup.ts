import type { VaultFileAdapter } from '../storage/VaultFileAdapter';

/** Shared backup location for memory and awareness files. */
const MEMORY_BACKUP_DIR = '.claudian-plus/backups';

/**
 * Copy a file to the backup directory before it is overwritten.
 *
 * The copy happens first; the original is only touched by the caller's own
 * write afterwards. A failed backup never blocks the write.
 */
export async function backupFileBeforeWrite(
  adapter: VaultFileAdapter,
  sourcePath: string,
  namePrefix: string,
  maxKeep = 20,
): Promise<void> {
  if (!(await adapter.exists(sourcePath))) {
    return;
  }
  try {
    const content = await adapter.read(sourcePath);
    if (!content.trim()) {
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${MEMORY_BACKUP_DIR}/${namePrefix}-${stamp}-${Math.random().toString(36).slice(2, 6)}.md`;
    await adapter.write(backupPath, content);
    await pruneBackups(adapter, namePrefix, maxKeep);
  } catch {
    // Backups must never block the primary write.
  }
}

/** Keep only the newest `maxKeep` backup files for a prefix. */
async function pruneBackups(
  adapter: VaultFileAdapter,
  namePrefix: string,
  maxKeep: number,
): Promise<void> {
  try {
    const files = (await adapter.listFiles(MEMORY_BACKUP_DIR))
      .filter(path => (path.split('/').pop() ?? '').startsWith(`${namePrefix}-`));
    if (files.length <= maxKeep) {
      return;
    }
    for (const file of files.sort().slice(0, files.length - maxKeep)) {
      await adapter.delete(file);
    }
  } catch {
    // Best effort.
  }
}
