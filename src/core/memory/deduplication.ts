/** Minimum content length required for containment-based deduplication. */
export const MIN_CONTAINMENT_LENGTH = 10;

/**
 * Normalize memory text content by trimming, collapsing whitespace,
 * and converting to lowercase.
 */
export function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Check if candidate content is a duplicate of any existing memory item.
 * Supports exact match and containment matching for strings >= MIN_CONTAINMENT_LENGTH.
 */
export function isMemoryDuplicate(
  candidate: string,
  existing: Array<string | { content: string }>,
): boolean {
  const normCandidate = normalizeMemoryContent(candidate);
  if (!normCandidate) {
    return false;
  }

  return existing.some((item) => {
    const rawExisting = typeof item === 'string' ? item : item.content;
    const normExisting = normalizeMemoryContent(rawExisting);
    if (!normExisting) {
      return false;
    }

    // Exact match
    if (normCandidate === normExisting) {
      return true;
    }

    // Containment check for strings with sufficient length
    if (normCandidate.length >= MIN_CONTAINMENT_LENGTH && normExisting.includes(normCandidate)) {
      return true;
    }
    if (normExisting.length >= MIN_CONTAINMENT_LENGTH && normCandidate.includes(normExisting)) {
      return true;
    }

    return false;
  });
}

/**
 * Deduplicate an array of memory objects using normalized string keys.
 */
export function deduplicateMemoryEntries<T>(
  entries: T[],
  keyFn: (entry: T) => string,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const entry of entries) {
    const raw = keyFn(entry);
    const normalized = normalizeMemoryContent(raw);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(entry);
  }

  return result;
}
