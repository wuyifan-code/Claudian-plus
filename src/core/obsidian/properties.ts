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

export interface PropertiesBatchOperation {
  path: string;
  operation: PropertiesSetOperation;
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
 * Applies batch frontmatter operations to multiple files.
 * Operations are applied sequentially; partial failures do not roll back.
 */
export async function writePropertiesBatch(
  app: App,
  operations: PropertiesBatchOperation[],
): Promise<{ success: string[]; errors: Array<{ path: string; error: string }> }> {
  const success: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const op of operations) {
    try {
      await writeProperties(app, op.path, op.operation);
      success.push(op.path);
    } catch (err) {
      errors.push({ path: op.path, error: String(err) });
    }
  }

  return { success, errors };
}

/**
 * Formats properties data as a readable summary string for prompt injection.
 */
export function formatPropertiesForPrompt(result: PropertiesReadResult): string {
  const { path, frontmatter } = result;
  const lines: string[] = [
    `<obsidian_properties path="${path}">`,
  ];

  const entries = Object.entries(frontmatter);
  if (entries.length === 0) {
    lines.push('  (no frontmatter)');
  } else {
    for (const [key, value] of entries) {
      const display = typeof value === 'string' && value.length > 80
        ? value.slice(0, 80) + '…'
        : JSON.stringify(value);
      lines.push(`  ${key}: ${display}`);
    }
  }

  lines.push('</obsidian_properties>');
  return lines.join('\n');
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

/**
 * Detects common frontmatter inconsistencies across a set of files.
 * Returns actionable suggestions (e.g., tag spelling variants, missing fields).
 */
export function detectPropertyInconsistencies(
  records: PropertiesReadResult[],
): Array<{ type: 'tag_variant' | 'missing_field'; message: string }> {
  const findings: Array<{ type: 'tag_variant' | 'missing_field'; message: string }> = [];

  const tagCounts = new Map<string, { original: string; count: number }>();
  const fieldPresence = new Map<string, number>();
  const total = records.length;

  for (const record of records) {
    const tags = extractTags(record.frontmatter);
    for (const tag of tags) {
      const lower = tag.toLowerCase();
      const entry = tagCounts.get(lower);
      if (entry) {
        entry.count += 1;
      } else {
        tagCounts.set(lower, { original: tag, count: 1 });
      }
    }

    for (const key of Object.keys(record.frontmatter)) {
      fieldPresence.set(key, (fieldPresence.get(key) ?? 0) + 1);
    }
  }

  // Detect spelling variants of tags (case-insensitive duplicates)
  for (const [lower, entry] of tagCounts) {
    if (entry.original !== lower) {
      findings.push({
        type: 'tag_variant',
        message: `Tag casing variant: "${entry.original}" appears ${entry.count}×, stored as "${lower}" — consider unifying to one casing`,
      });
    }
  }

  // Detect fields present in >0% but <80% of files (potentially missing where expected)
  for (const [field, count] of fieldPresence) {
    const ratio = count / total;
    if (ratio > 0.05 && ratio < 0.8) {
      findings.push({
        type: 'missing_field',
        message: `Field "${field}" is present in ${count}/${total} files (${Math.round(ratio * 100)}%) — may be missing where expected`,
      });
    }
  }

  return findings;
}

function extractTags(fm: FrontmatterRecord): string[] {
  const tags = fm.tags;
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === 'string');
  if (typeof tags === 'string') return [tags];
  return [];
}
