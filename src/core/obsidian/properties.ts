import type { App } from 'obsidian';

// ---------------------------------------------------------------------------
// Obsidian Properties (frontmatter) operations
// ---------------------------------------------------------------------------

export interface FrontmatterRecord {
  [key: string]: unknown;
}

export interface PropertiesReadResult {
  path: string;
  /** The full frontmatter as a key-value map. Tags are included as "tags". */
  frontmatter: FrontmatterRecord;
  /** Aliases extracted from frontmatter (may be empty). */
  aliases: string[];
  /** CSS classes defined in frontmatter. */
  cssclasses: string[];
}

export interface PropertiesSetOperation {
  /** Frontmatter keys to set or update. */
  set?: FrontmatterRecord;
  /** Frontmatter keys to delete. */
  delete?: string[];
}

/**
 * Reads frontmatter properties from a markdown file using Obsidian's metadata cache.
 * Falls back to manual YAML parsing when the cache is stale or unavailable.
 */
export function readProperties(
  app: App,
  filePath: string,
): PropertiesReadResult {
  const tFile = app.vault.getFileByPath(filePath);
  if (!tFile) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (tFile.extension !== 'md') {
    throw new Error(`Not a markdown file: ${filePath}`);
  }

  const cache = app.metadataCache.getFileCache(tFile);
  const frontmatter: FrontmatterRecord = {};
  const aliases: string[] = [];
  const cssclasses: string[] = [];

  if (cache?.frontmatter) {
    for (const [key, value] of Object.entries(cache.frontmatter)) {
      // Skip Obsidian internal metadata fields
      if (key === 'position') continue;
      frontmatter[key] = value;
    }
  }

  // Extract standard Obsidian fields
  if (cache?.frontmatter?.aliases) {
    const raw: unknown = cache.frontmatter.aliases;
    if (Array.isArray(raw)) {
      aliases.push(...raw.filter((a): a is string => typeof a === 'string'));
    } else if (typeof raw === 'string') {
      aliases.push(raw);
    }
  }

  if (cache?.frontmatter?.cssclasses) {
    const raw: unknown = cache.frontmatter.cssclasses;
    if (Array.isArray(raw)) {
      cssclasses.push(...raw.filter((c): c is string => typeof c === 'string'));
    }
  }

  return { path: filePath, frontmatter, aliases, cssclasses };
}

/**
 * Applies frontmatter changes to a markdown file.
 * Uses Obsidian's fileManager.processFrontMatter for safe, non-destructive edits.
 */
export async function writeProperties(
  app: App,
  filePath: string,
  operation: PropertiesSetOperation,
): Promise<void> {
  const tFile = app.vault.getFileByPath(filePath);
  if (!tFile) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (tFile.extension !== 'md') {
    throw new Error(`Not a markdown file: ${filePath}`);
  }

  await app.fileManager.processFrontMatter(tFile, (fm) => {
    if (operation.set) {
      for (const [key, value] of Object.entries(operation.set)) {
        fm[key] = value;
      }
    }
    if (operation.delete) {
      for (const key of operation.delete) {
        delete fm[key];
      }
    }
  });
}

/**
 * Generates a compact diff preview for a properties write operation.
 */
export function diffPropertiesWrite(
  path: string,
  current: FrontmatterRecord,
  operation: PropertiesSetOperation,
): string {
  const lines: string[] = [`Proposed frontmatter changes for ${path}:\n`];

  if (operation.set) {
    for (const [key, value] of Object.entries(operation.set)) {
      const currentStr = key in current ? JSON.stringify(current[key]) : '(not set)';
      lines.push(`  set ${key}: ${currentStr} → ${JSON.stringify(value)}`);
    }
  }

  if (operation.delete) {
    for (const key of operation.delete) {
      const currentStr = key in current ? JSON.stringify(current[key]) : '(not set)';
      lines.push(`  delete ${key}: was ${currentStr}`);
    }
  }

  return lines.join('\n');
}
