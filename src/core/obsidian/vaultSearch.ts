import type { App, TFile } from 'obsidian';

export interface VaultSearchNoteResult {
  path: string;
  title: string;
  score: number;
  tags: string[];
  headings: string[];
  matches: string[];
  excerpt?: string;
}

export interface VaultSearchResponse {
  query: string;
  totalMatches: number;
  results: VaultSearchNoteResult[];
}

export interface VaultSearchOptions {
  limit?: number;
  excludeFolders?: string[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * Searches markdown notes in the vault by keyword using metadataCache and vault files.
 */
export async function searchVaultNotes(
  app: App,
  query: string,
  options: VaultSearchOptions = {},
): Promise<VaultSearchResponse> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error('Search query must be a non-empty string.');
  }

  const terms = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT));

  // Get all markdown files in vault
  const files: TFile[] = typeof app.vault?.getMarkdownFiles === 'function'
    ? app.vault.getMarkdownFiles()
    : [];

  const configDir = (app.vault as { configDir?: string }).configDir?.replace(/^\/+|\/+$/g, '') ?? '';
  const rawExcludeFolders = [
    ...(options.excludeFolders ?? []),
    ...(configDir ? [configDir] : []),
    '.trash',
  ];
  const normalizedExcludeFolders = rawExcludeFolders
    .map(f => f.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);

  const matches: VaultSearchNoteResult[] = [];

  for (const file of files) {
    // Check if path is in excluded folders
    const pathParts = file.path.split('/');
    const isExcluded = normalizedExcludeFolders.some(folder => (
      file.path === folder ||
      file.path.startsWith(`${folder}/`) ||
      pathParts.includes(folder)
    ));
    if (isExcluded) {
      continue;
    }

    const cache = app.metadataCache?.getFileCache?.(file);
    const title = file.basename || pathParts[pathParts.length - 1].replace(/\.md$/i, '');
    const titleLower = title.toLowerCase();
    const pathLower = file.path.toLowerCase();

    // Extract tags
    const tags: string[] = [];
    const fm = cache?.frontmatter;
    if (fm?.tags) {
      if (Array.isArray(fm.tags)) {
        tags.push(...fm.tags.filter((t): t is string => typeof t === 'string'));
      } else if (typeof fm.tags === 'string') {
        tags.push(...fm.tags.split(',').map(t => t.trim()));
      }
    }
    if (cache?.tags) {
      tags.push(...cache.tags.map(t => t.tag.replace(/^#/, '')));
    }
    const uniqueTags = [...new Set(tags)];

    // Extract headings
    const headings = cache?.headings?.map(h => h.heading) ?? [];

    let score = 0;
    const matchReasons: string[] = [];

    for (const term of terms) {
      let termMatched = false;

      // Title match
      if (titleLower.includes(term)) {
        score += 10;
        if (!termMatched) {
          matchReasons.push(`title:"${term}"`);
          termMatched = true;
        }
      }

      // Tag match
      const matchingTag = uniqueTags.find(tag => tag.toLowerCase().includes(term));
      if (matchingTag) {
        score += 6;
        if (!termMatched) {
          matchReasons.push(`tag:"${matchingTag}"`);
          termMatched = true;
        }
      }

      // Heading match
      const matchingHeading = headings.find(h => h.toLowerCase().includes(term));
      if (matchingHeading) {
        score += 4;
        if (!termMatched) {
          matchReasons.push(`heading:"${matchingHeading}"`);
          termMatched = true;
        }
      }

      // Path match (other segments)
      if (!titleLower.includes(term) && pathLower.includes(term)) {
        score += 2;
        if (!termMatched) {
          matchReasons.push(`path:"${term}"`);
        }
      }
    }

    if (score > 0) {
      matches.push({
        path: file.path,
        title,
        score,
        tags: uniqueTags,
        headings,
        matches: matchReasons,
      });
    }
  }

  // Sort descending by score, then alphabetically by path
  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const topResults = matches.slice(0, limit);
  const fileMap = new Map<string, TFile>(files.map(f => [f.path, f]));
  if (typeof app.vault?.cachedRead === 'function') {
    for (const match of topResults) {
      const file = fileMap.get(match.path);
      if (file) {
        try {
          const content = await app.vault.cachedRead(file);
          const excerpt = extractExcerpt(content, terms);
          if (excerpt) {
            match.excerpt = excerpt;
          }
        } catch {
          // Ignore read error for excerpt
        }
      }
    }
  }

  return {
    query: trimmedQuery,
    totalMatches: matches.length,
    results: topResults,
  };
}

function extractExcerpt(content: string, terms: string[], maxLen = 160): string {
  const clean = content.replace(/^---[\s\S]*?---\r?\n/, '').trim();
  if (!clean) return '';
  const cleanLower = clean.toLowerCase();
  let firstIndex = -1;
  for (const term of terms) {
    const idx = cleanLower.indexOf(term);
    if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
      firstIndex = idx;
    }
  }
  if (firstIndex === -1) {
    return clean.slice(0, maxLen).replace(/\s+/g, ' ').trim();
  }
  const start = Math.max(0, firstIndex - 40);
  const end = Math.min(clean.length, start + maxLen);
  return (start > 0 ? '… ' : '') + clean.slice(start, end).replace(/\s+/g, ' ').trim() + (end < clean.length ? ' …' : '');
}
