/**
 * A graph neighbor discovered from Obsidian's resolved link cache.
 *
 * This module intentionally contains no UI or Obsidian runtime imports. It
 * keeps Canvas neighbor ranking deterministic and makes the behavior easy to
 * exercise in unit tests and reuse from other surfaces later.
 */
export interface CanvasNeighborSuggestion {
  path: string;
  relation: 'outgoing' | 'incoming' | 'both';
  linkCount: number;
  via: string[];
}

/**
 * Build one-hop note suggestions around the files represented by selected
 * Canvas nodes. Existing selection nodes are excluded and duplicate edges are
 * merged so a Canvas selection produces a compact, explainable list.
 */
export function buildCanvasNeighborSuggestions(
  selectedPaths: string[],
  resolvedLinks: Record<string, Record<string, number>> = {},
  limit = 12,
): CanvasNeighborSuggestion[] {
  const selected = new Map<string, string>();
  for (const path of selectedPaths) {
    const trimmed = path.trim();
    if (!trimmed) continue;
    selected.set(normalizePath(trimmed), trimmed);
  }

  const candidates = new Map<string, {
    path: string;
    relation: Set<'outgoing' | 'incoming'>;
    linkCount: number;
    via: Set<string>;
  }>();

  const add = (
    candidatePath: string,
    relation: 'outgoing' | 'incoming',
    linkCount: number,
    viaPath: string,
  ): void => {
    const trimmed = candidatePath.trim();
    if (!trimmed || linkCount <= 0) return;
    const candidateKey = normalizePath(trimmed);
    if (selected.has(candidateKey)) return;
    const current = candidates.get(candidateKey) ?? {
      path: trimmed,
      relation: new Set<'outgoing' | 'incoming'>(),
      linkCount: 0,
      via: new Set<string>(),
    };
    current.relation.add(relation);
    current.linkCount += linkCount;
    current.via.add(viaPath);
    candidates.set(candidateKey, current);
  };

  for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
    const sourceKey = normalizePath(sourcePath);
    const selectedSource = selected.get(sourceKey);
    for (const [targetPath, rawCount] of Object.entries(targets ?? {})) {
      const linkCount = typeof rawCount === 'number' ? rawCount : Number(rawCount);
      if (!Number.isFinite(linkCount) || linkCount <= 0) continue;
      const selectedTarget = selected.get(normalizePath(targetPath));
      if (selectedSource) add(targetPath, 'outgoing', linkCount, selectedSource);
      if (selectedTarget) add(sourcePath, 'incoming', linkCount, selectedTarget);
    }
  }

  const safeLimit = Math.max(1, Math.floor(limit));
  return [...candidates.values()]
    .map(candidate => ({
      path: candidate.path,
      relation: candidate.relation.has('outgoing') && candidate.relation.has('incoming')
        ? 'both' as const
        : candidate.relation.has('outgoing')
          ? 'outgoing' as const
          : 'incoming' as const,
      linkCount: candidate.linkCount,
      via: [...candidate.via].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => {
      const relationRank = (value: CanvasNeighborSuggestion['relation']): number => value === 'both' ? 0 : 1;
      return relationRank(left.relation) - relationRank(right.relation)
        || right.linkCount - left.linkCount
        || left.path.localeCompare(right.path);
    })
    .slice(0, safeLimit);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/u, '').toLowerCase();
}
