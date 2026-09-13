import {
  ACTIVITY_FILE,
  AWARENESS_DIR,
  LEGACY_SOUL_FILE,
  SHORT_TERM_DIR,
  SOUL_FILE,
  USER_FILE,
} from '@/core/memory/consciousness-types';
import { createMemoryCachePolicy } from '@/core/memory/memoryCachePolicy';
import { STAGING_HABITS_FILE } from '@/core/memory/MindStore';
import { DEFAULT_MEMORY_FILE_PATH, LEGACY_MEMORY_FILE_PATH } from '@/core/memory/types';

describe('createMemoryCachePolicy', () => {
  const createPolicy = (memoryFilePath: string | undefined = DEFAULT_MEMORY_FILE_PATH) =>
    createMemoryCachePolicy({ getMemoryFilePath: () => memoryFilePath });

  it('accepts the awareness directory and everything inside it', () => {
    const shouldCache = createPolicy();

    expect(shouldCache(AWARENESS_DIR)).toBe(true);
    expect(shouldCache(SOUL_FILE)).toBe(true);
    expect(shouldCache(USER_FILE)).toBe(true);
    expect(shouldCache(ACTIVITY_FILE)).toBe(true);
    expect(shouldCache(STAGING_HABITS_FILE)).toBe(true);
    expect(shouldCache(`${SHORT_TERM_DIR}/2026-09-13.md`)).toBe(true);
  });

  it('accepts the legacy awareness directory', () => {
    const shouldCache = createPolicy();

    expect(shouldCache(LEGACY_SOUL_FILE)).toBe(true);
  });

  it('accepts the default and legacy memory files', () => {
    const shouldCache = createPolicy();

    expect(shouldCache(DEFAULT_MEMORY_FILE_PATH)).toBe(true);
    expect(shouldCache(LEGACY_MEMORY_FILE_PATH)).toBe(true);
  });

  it('follows a custom memory file path from settings', () => {
    expect(createPolicy('notes/custom-memory.md')('notes/custom-memory.md')).toBe(true);
    expect(createPolicy('notes/custom-memory.md')(DEFAULT_MEMORY_FILE_PATH)).toBe(false);
  });

  it('ignores the memory file path while settings are still loading', () => {
    const shouldCache = createMemoryCachePolicy({ getMemoryFilePath: () => undefined });

    expect(shouldCache(DEFAULT_MEMORY_FILE_PATH)).toBe(false);
    expect(shouldCache(SOUL_FILE)).toBe(true);
  });

  it('rejects session metadata, settings, backups and provider storage', () => {
    const shouldCache = createPolicy();

    expect(shouldCache('.claudian-plus/sessions/abc.meta.json')).toBe(false);
    expect(shouldCache('.claudian-plus/claudian-plus-settings.json')).toBe(false);
    expect(shouldCache('.claudian-plus/backups/memory-123.md')).toBe(false);
    expect(shouldCache('.claudian-plus')).toBe(false);
    expect(shouldCache('.claudian')).toBe(false);
    expect(shouldCache('.claude/settings.json')).toBe(false);
    expect(shouldCache('notes/daily.md')).toBe(false);
    expect(shouldCache('')).toBe(false);
  });

  it('does not treat a sibling with a shared prefix as cacheable', () => {
    const shouldCache = createPolicy();

    expect(shouldCache('.claudian-plus/awareness-archive/old.md')).toBe(false);
  });
});
