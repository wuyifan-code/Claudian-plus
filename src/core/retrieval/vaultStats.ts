import type { App, TFile } from 'obsidian';

/** Extracts Obsidian's unresolved-links map (broken target -> occurrences). */
export function getUnresolvedLinks(app: App): Record<string, Record<string, number>> {
  const metadataCache = app.metadataCache as unknown as Record<string, unknown>;
  const unresolvedLinks = metadataCache.unresolvedLinks;
  return typeof unresolvedLinks === 'object' && unresolvedLinks
    ? unresolvedLinks as Record<string, Record<string, number>>
    : {};
}

/** Counts total broken-link occurrences across all notes. */
export function countBrokenLinks(unresolvedLinks: Record<string, Record<string, number>>): number {
  return Object.values(unresolvedLinks)
    .reduce((sum, links) => sum + Object.keys(links).length, 0);
}

/** Returns markdown files modified within the last `days` days, newest first. */
export function getRecentlyModifiedFiles(app: App, days: number): TFile[] {
  const now = Date.now();
  const lookbackMs = days * 24 * 60 * 60 * 1000;
  return app.vault.getMarkdownFiles()
    .filter(file => file.stat.mtime > now - lookbackMs)
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
}
