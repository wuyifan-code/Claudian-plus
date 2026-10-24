import type { MemoryKind } from './types';

/**
 * Stable claim keys.
 *
 * LLM-generated keys are unstable across phrasings of the same fact, which
 * defeats the repository's same-claimKey dedupe. The canonical key is a
 * deterministic hash of the normalized content, so identical content always
 * maps to the same key without depending on model output.
 */

const KIND_PREFIX: Record<MemoryKind, string> = {
  profile: 'user',
  project_state: 'project',
  lesson: 'lesson',
};

/** Lowercase, Unicode-normalized, punctuation/space-collapsed text. */
export function normalizeClaimText(content: string): string {
  return content
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

/** FNV-1a 32-bit hash as 8 hex chars. */
export function hashClaimText(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Deterministic claim key for a kind + content pair. */
export function canonicalClaimKey(kind: MemoryKind, content: string): string {
  const prefix = KIND_PREFIX[kind];
  const normalized = normalizeClaimText(content);
  if (!normalized) {
    return `${prefix}.blank_${hashClaimText(content)}`;
  }
  return `${prefix}.${hashClaimText(normalized)}`;
}

/** True when a key is safe to store: non-empty, bounded, single line. */
export function isValidClaimKey(key: string): boolean {
  return (
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= 96 &&
    !/\s/.test(key)
  );
}

/** Returns the key when valid, otherwise the canonical fallback. */
export function resolveClaimKey(
  key: string | undefined,
  kind: MemoryKind,
  content: string,
): string {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  return isValidClaimKey(trimmed) ? trimmed : canonicalClaimKey(kind, content);
}

/** Normalizes model-provided keywords: trimmed, lowercased, deduped, capped. */
export function sanitizeKeywords(keywords: unknown, max = 8): string[] {
  if (!Array.isArray(keywords)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of keywords) {
    if (typeof item !== 'string') continue;
    const keyword = item.trim().toLowerCase().slice(0, 40);
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    result.push(keyword);
    if (result.length >= max) break;
  }
  return result;
}
