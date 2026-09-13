/**
 * Which vault paths the read cache in front of `VaultFileAdapter` may hold.
 *
 * Deliberately a whitelist. The memory file, the awareness directory and the
 * mind stores change rarely and are re-read on every turn, which makes them
 * worth caching. Everything else the shared adapter serves - session metadata,
 * conversation transcripts, provider history, plugin settings - keeps its
 * existing I/O profile and memory footprint.
 */

import { isPathWithin } from '../storage/CachedVaultAdapter';
import { AWARENESS_DIR, LEGACY_AWARENESS_DIR } from './consciousness-types';
import { LEGACY_MEMORY_FILE_PATH } from './types';

export interface MemoryCachePolicyOptions {
  /** Live settings lookup: the memory file path is user configurable. */
  getMemoryFilePath: () => string | undefined;
}

/** Directories whose contents belong to the memory subsystem, including the folder itself. */
const CACHED_ROOTS: readonly string[] = [AWARENESS_DIR, LEGACY_AWARENESS_DIR];

export function createMemoryCachePolicy(
  options: MemoryCachePolicyOptions,
): (path: string) => boolean {
  return (path: string): boolean => {
    if (!path) {
      return false;
    }

    if (CACHED_ROOTS.some(root => isPathWithin(path, root))) {
      return true;
    }

    if (isPathWithin(path, LEGACY_MEMORY_FILE_PATH)) {
      return true;
    }

    const memoryFilePath = options.getMemoryFilePath();
    return typeof memoryFilePath === 'string' && memoryFilePath.length > 0
      ? isPathWithin(path, memoryFilePath)
      : false;
  };
}
