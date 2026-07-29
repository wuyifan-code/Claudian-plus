import type { VaultRetrievalResult } from './VaultRetrievalService';

/**
 * Builds a bounded, noise-reduced query for note-link recommendations.
 *
 * The retrieval layer is intentionally provider-neutral. Keeping this
 * normalization here means the editor command, future save-time hooks, and
 * any provider can use the same query semantics without importing Obsidian UI
 * types into core.
 */
export function buildLinkRecommendationQuery(
  noteContent: string,
  selectedText = '',
  maxChars = 2_000,
): string {
  const source = selectedText.trim() || noteContent.trim();
  if (!source) return '';

  // Code blocks and frontmatter usually describe implementation details or
  // metadata rather than the prose relationship a user wants to link.
  const withoutCode = source.replace(/```[\s\S]*?```/g, ' ');
  const withoutFrontmatter = withoutCode.replace(/^---\s*[\r\n]+[\s\S]*?[\r\n]+---\s*/u, '');
  return withoutFrontmatter.replace(/\s+/g, ' ').trim().slice(0, Math.max(200, maxChars));
}

/**
 * Removes self-links/already-linked notes and gives each candidate a reason
 * that can be shown before the user inserts anything into the note.
 */
export function filterLinkRecommendationCandidates(
  sourcePath: string,
  results: VaultRetrievalResult[],
  outgoingLinks: Record<string, unknown>,
  options: { limit?: number; minScore?: number } = {},
): VaultRetrievalResult[] {
  const sourceKey = normalizePath(sourcePath);
  const existing = new Set(Object.keys(outgoingLinks).map(normalizePath));
  const seen = new Set<string>();
  const minScore = options.minScore ?? 0.16;
  const limit = Math.max(1, options.limit ?? 8);

  return results
    .filter(result => {
      const resultKey = normalizePath(result.path);
      if (resultKey === sourceKey || existing.has(resultKey) || seen.has(resultKey)) return false;
      if (result.score < minScore) return false;
      seen.add(resultKey);
      return true;
    })
    .slice(0, limit)
    .map(result => ({
      ...result,
      recommendationReason: buildRecommendationReason(result),
    }));
}

function buildRecommendationReason(result: VaultRetrievalResult): string {
  if (result.semanticScore !== undefined) {
    return `Semantic similarity ${(Math.max(0, result.semanticScore) * 100).toFixed(0)}%`;
  }
  if (result.matchedTerms.length > 0) {
    return `Shares terms: ${result.matchedTerms.slice(0, 5).join(', ')}`;
  }
  return 'Local retrieval signal';
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/u, '').toLowerCase();
}
