export interface InsightSource {
  path: string;
  text: string;
  modifiedAt: number;
}

export interface InsightTopic {
  term: string;
  count: number;
  sourcePaths: string[];
}

export interface InsightOpenLoop {
  text: string;
  path: string;
  line: number;
}

export interface InsightLinkSignal {
  path: string;
  outgoingCount: number;
  brokenCount: number;
}

export interface VaultInsightReport {
  topics: InsightTopic[];
  openLoops: InsightOpenLoop[];
  linkSignals: InsightLinkSignal[];
  sourceCount: number;
}

export interface TagNormalizationSuggestion {
  canonical: string;
  variants: string[];
  sourcePaths: string[];
}

export interface MocSuggestion {
  topic: string;
  paths: string[];
  directories: string[];
  suggestedMocPath: string;
}

const MAX_TOPICS = 8;
const MAX_OPEN_LOOPS = 12;
const MAX_LINK_SIGNALS = 10;
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'been', 'being', 'between', 'could',
  'from', 'have', 'into', 'more', 'most', 'other', 'should', 'some', 'than', 'that',
  'their', 'there', 'these', 'they', 'this', 'through', 'using', 'what', 'when',
  'where', 'which', 'with', 'would', 'your', 'note', 'notes', 'todo',
]);

/**
 * Builds deterministic, source-backed insight signals for a review report.
 *
 * This is intentionally not marketed as semantic embedding search. It is a
 * transparent local layer that surfaces repeated topics, unfinished loops,
 * and link activity while an optional learned index is unavailable.
 */
export function buildVaultInsights(
  sources: InsightSource[],
  unresolvedLinks: Record<string, Record<string, number>> = {},
): VaultInsightReport {
  const topicCounts = new Map<string, { count: number; paths: Set<string> }>();
  const openLoops: InsightOpenLoop[] = [];
  const linkSignals: InsightLinkSignal[] = [];

  for (const source of sources) {
    const body = stripMetadataAndCode(source.text);
    const sourceTerms = new Set(extractTopicTerms(body.replace(/\[\[[^\]]+\]\]/g, ' ')));
    for (const term of sourceTerms) {
      const current = topicCounts.get(term) ?? { count: 0, paths: new Set<string>() };
      current.count += countOccurrences(body, term);
      current.paths.add(source.path);
      topicCounts.set(term, current);
    }

    for (const [index, line] of source.text.split(/\r?\n/).entries()) {
      const match = line.match(/^\s*[-*]\s+\[\s*\]\s+(.+?)\s*$/);
      if (!match) continue;
      openLoops.push({ text: match[1], path: source.path, line: index + 1 });
    }

    const outgoing = extractWikiLinks(body);
    const brokenCount = Object.keys(unresolvedLinks[source.path] ?? {}).length;
    if (outgoing.length > 0 || brokenCount > 0) {
      linkSignals.push({ path: source.path, outgoingCount: outgoing.length, brokenCount });
    }
  }

  const topics = [...topicCounts.entries()]
    .map(([term, value]) => ({ term, count: value.count, sourcePaths: [...value.paths].sort() }))
    .sort((left, right) => right.count - left.count || right.sourcePaths.length - left.sourcePaths.length || left.term.localeCompare(right.term))
    .slice(0, MAX_TOPICS);

  openLoops.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
  linkSignals.sort((left, right) => (
    right.brokenCount - left.brokenCount
    || right.outgoingCount - left.outgoingCount
    || left.path.localeCompare(right.path)
  ));

  return {
    topics,
    openLoops: openLoops.slice(0, MAX_OPEN_LOOPS),
    linkSignals: linkSignals.slice(0, MAX_LINK_SIGNALS),
    sourceCount: sources.length,
  };
}

function stripMetadataAndCode(text: string): string {
  return text
    .replace(/^---\s*[\r\n]+[\s\S]*?[\r\n]+(?:---|\.\.\.)\s*/u, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTopicTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z][a-z0-9_-]{2,}|[\u3400-\u9fff]{2}/gu)) {
    const term = match[0];
    if (term.length >= 3 && STOP_WORDS.has(term)) continue;
    terms.add(term);
  }
  return [...terms];
}

function countOccurrences(text: string, term: string): number {
  if (/^[\u3400-\u9fff]{2}$/u.test(term)) {
    return [...text].filter((_, index, chars) => chars.slice(index, index + 2).join('') === term).length;
  }
  return text.toLowerCase().split(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'g')).length - 1;
}

function extractWikiLinks(text: string): string[] {
  const links = new Set<string>();
  for (const match of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1]?.trim();
    if (target) links.add(target);
  }
  return [...links];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MAX_TAG_NORMALIZATIONS = 5;
const MAX_MOC_SUGGESTIONS = 5;

/**
 * Detects tag inconsistencies across sources: case-insensitive duplicates and
 * prefix overlaps where a shorter tag appears independently alongside a longer
 * variant (e.g. "rust" used in some notes, "rust-lang" in others).
 */
export function buildTagNormalizations(
  sources: InsightSource[],
): TagNormalizationSuggestion[] {
  const tagPaths = new Map<string, Set<string>>();
  for (const source of sources) {
    const tags = extractFrontmatterTags(source.text);
    for (const tag of tags) {
      if (!tag) continue;
      const normalized = tag.replace(/^#/, '').trim();
      if (!normalized) continue;
      const paths = tagPaths.get(normalized) ?? new Set<string>();
      paths.add(source.path);
      tagPaths.set(normalized, paths);
    }
  }

  if (tagPaths.size === 0) return [];

  const allTags = [...tagPaths.keys()];
  const lowerToCanonical = new Map<string, string>();
  for (const tag of allTags) {
    const lower = tag.toLowerCase();
    const existing = lowerToCanonical.get(lower);
    if (existing !== undefined) continue;
    lowerToCanonical.set(lower, tag);
  }

  // First pass: case-insensitive duplicates
  const caseGroups = new Map<string, { variants: Set<string>; paths: Set<string> }>();
  for (const tag of allTags) {
    const lower = tag.toLowerCase();
    if (!caseGroups.has(lower)) {
      caseGroups.set(lower, { variants: new Set<string>(), paths: new Set<string>() });
    }
    caseGroups.get(lower)!.variants.add(tag);
    for (const p of tagPaths.get(tag)!) caseGroups.get(lower)!.paths.add(p);
  }

  const suggestions: TagNormalizationSuggestion[] = [];

  for (const [, group] of caseGroups) {
    if (group.variants.size <= 1) continue;
    const sortedVariants = [...group.variants].sort();
    // Prefer the lowercase variant as canonical; fall back to first sorted
    const canonical = sortedVariants.find(v => v === v.toLowerCase()) ?? sortedVariants[0];
    suggestions.push({
      canonical,
      variants: sortedVariants,
      sourcePaths: [...group.paths].sort(),
    });
  }

  // Second pass: prefix overlaps — a shorter tag used independently should
  // absorb a longer tag variant (e.g. "rust" + "rust-lang")
  const tagSet = new Set(allTags.map(t => t.toLowerCase()));
  const prefixOverlaps = new Map<string, { variants: Set<string>; paths: Set<string> }>();

  for (const baseTag of allTags) {
    const lowerBase = baseTag.toLowerCase();
    if (!tagSet.has(lowerBase)) continue; // must be an actual tag, not a substring
    for (const otherTag of allTags) {
      const lowerOther = otherTag.toLowerCase();
      if (lowerOther === lowerBase) continue;
      // Only flag when the shorter tag exists as its own standalone tag
      // and the longer tag starts with "<shorter>-".
      if (lowerOther.startsWith(`${lowerBase}-`)) {
        if (!prefixOverlaps.has(lowerBase)) {
          prefixOverlaps.set(lowerBase, { variants: new Set<string>(), paths: new Set<string>() });
        }
        const entry = prefixOverlaps.get(lowerBase)!;
        entry.variants.add(baseTag);
        entry.variants.add(otherTag);
        for (const p of tagPaths.get(baseTag)!) entry.paths.add(p);
        for (const p of tagPaths.get(otherTag)!) entry.paths.add(p);
      }
    }
  }

  for (const [canonicalLower, group] of prefixOverlaps) {
    const canonical = lowerToCanonical.get(canonicalLower) ?? canonicalLower;
    suggestions.push({
      canonical,
      variants: [...group.variants].sort(),
      sourcePaths: [...group.paths].sort(),
    });
  }

  return suggestions.slice(0, MAX_TAG_NORMALIZATIONS);
}

/**
 * Detects topics spread across multiple directories and suggests MOC index
 * pages where they could be consolidated.
 */
export function buildMocSuggestions(sources: InsightSource[]): MocSuggestion[] {
  // Group source paths by topic term → directory→files
  const topicDirs = new Map<string, Map<string, string[]>>();

  for (const source of sources) {
    const body = stripMetadataAndCode(source.text);
    const terms = extractTopicTerms(body.replace(/\[\[[^\]]+\]\]/g, ' '));
    const dir = source.path.includes('/') ? source.path.split('/').slice(0, -1).join('/') : '.';

    for (const term of terms) {
      if (!topicDirs.has(term)) {
        topicDirs.set(term, new Map<string, string[]>());
      }
      const dirMap = topicDirs.get(term)!;
      const files = dirMap.get(dir) ?? [];
      files.push(source.path);
      dirMap.set(dir, files);
    }
  }

  const suggestions: MocSuggestion[] = [];

  for (const [topic, dirMap] of topicDirs) {
    if (dirMap.size < 2) continue; // Must span at least 2 directories

    const allPaths: string[] = [];
    for (const files of dirMap.values()) allPaths.push(...files);

    // Find the most frequent directory as the suggested MOC location
    let bestDir = '';
    let bestCount = 0;
    for (const [dir, files] of dirMap) {
      if (files.length > bestCount) {
        bestCount = files.length;
        bestDir = dir;
      }
    }

    const directories = [...dirMap.keys()].sort();
    const safeName = topic.replace(/[<>:"/\\|?*#]/g, '-').replace(/^-+|-+$/g, '');
    const suggestedMocPath = `${bestDir}/${safeName}-MOC.md`;

    suggestions.push({
      topic,
      paths: allPaths.sort(),
      directories,
      suggestedMocPath,
    });
  }

  return suggestions
    .sort((a, b) => b.directories.length - a.directories.length
      || b.paths.length - a.paths.length
      || a.topic.localeCompare(b.topic))
    .slice(0, MAX_MOC_SUGGESTIONS);
}

function extractFrontmatterTags(text: string): string[] {
  const fmMatch = text.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+(?:---|\.\.\.)\s*$/m);
  if (!fmMatch) return [];

  const fm = fmMatch[1];
  const tags: string[] = [];

  // Inline array: tags: [rust, async, cli]
  const inlineMatch = fm.match(/^\s*tags:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    tags.push(...inlineMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean));
  }

  // YAML list: tags:\n  - rust\n  - async
  let inTags = false;
  for (const line of fm.split(/[\r\n]+/)) {
    if (/^\s*tags\s*:/.test(line) && !line.includes('[')) {
      inTags = true;
      continue;
    }
    if (inTags) {
      const listMatch = line.match(/^\s*-\s+(.+)/);
      if (listMatch) {
        tags.push(listMatch[1].trim().replace(/['"]/g, ''));
      } else if (/^\s*[a-zA-Z]/.test(line) || line.trim() === '') {
        inTags = false;
      }
    }
  }

  return tags;
}
