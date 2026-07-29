import type { App } from 'obsidian';

export interface ObsidianLinkTarget {
  target: string;
  linkCount: number;
}

export interface ObsidianLinkSource {
  source: string;
  linkCount: number;
}

export interface ObsidianLinksResult {
  outgoing: ObsidianLinkTarget[];
  incoming: ObsidianLinkSource[];
  unresolved: string[];
}

export interface ObsidianGraphNeighbor {
  path: string;
  distance: number;
  linkCount: number;
}

/** Read link relationships from Obsidian's metadata cache. */
export function buildObsidianLinks(app: App, filePath: string): ObsidianLinksResult {
  const resolved = app.metadataCache.resolvedLinks ?? {};
  const unresolved = app.metadataCache.unresolvedLinks ?? {};
  const outgoing = Object.entries(resolved[filePath] ?? {})
    .filter(([, linkCount]) => typeof linkCount === 'number' && linkCount > 0)
    .map(([target, linkCount]) => ({ target, linkCount }))
    .sort((left, right) => right.linkCount - left.linkCount || left.target.localeCompare(right.target));
  const incoming = Object.entries(resolved)
    .flatMap(([source, targets]) => {
      const linkCount = targets[filePath];
      return typeof linkCount === 'number' && linkCount > 0 ? [{ source, linkCount }] : [];
    })
    .sort((left, right) => right.linkCount - left.linkCount || left.source.localeCompare(right.source));
  return {
    outgoing,
    incoming,
    unresolved: Object.keys(unresolved[filePath] ?? {}).sort(),
  };
}

/** Traverse the undirected metadata-cache graph with a hard depth cap. */
export function buildObsidianGraphNeighbors(
  app: App,
  startPath: string,
  requestedDepth: unknown,
): ObsidianGraphNeighbor[] {
  const depth = Math.max(
    1,
    Math.min(3, typeof requestedDepth === 'number' ? Math.floor(requestedDepth) : 1),
  );
  const resolved = app.metadataCache.resolvedLinks ?? {};
  const adjacency = new Map<string, Map<string, number>>();
  const addEdge = (from: string, to: string, count: number): void => {
    const targets = adjacency.get(from) ?? new Map<string, number>();
    targets.set(to, (targets.get(to) ?? 0) + count);
    adjacency.set(from, targets);
  };

  for (const [source, targets] of Object.entries(resolved)) {
    for (const [target, count] of Object.entries(targets)) {
      if (typeof count !== 'number' || count <= 0) continue;
      addEdge(source, target, count);
      addEdge(target, source, count);
    }
  }

  const visited = new Map<string, { distance: number; linkCount: number }>([
    [startPath, { distance: 0, linkCount: 0 }],
  ]);
  const queue = [startPath];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDistance = visited.get(current)!.distance;
    if (currentDistance >= depth) continue;
    for (const [neighbor, count] of adjacency.get(current) ?? []) {
      if (neighbor === startPath) continue;
      const nextDistance = currentDistance + 1;
      const previous = visited.get(neighbor);
      if (!previous || nextDistance < previous.distance) {
        visited.set(neighbor, { distance: nextDistance, linkCount: count });
        queue.push(neighbor);
      } else if (nextDistance === previous.distance) {
        previous.linkCount += count;
      }
    }
  }

  return [...visited.entries()]
    .filter(([filePath]) => filePath !== startPath)
    .map(([filePath, value]) => ({ path: filePath, ...value }))
    .sort((left, right) => left.distance - right.distance
      || right.linkCount - left.linkCount
      || left.path.localeCompare(right.path));
}
