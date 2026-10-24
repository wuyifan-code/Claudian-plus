import {
  canonicalClaimKey,
  hashClaimText,
  isValidClaimKey,
  normalizeClaimText,
  resolveClaimKey,
  sanitizeKeywords,
} from '@/core/memory/v2/claimKey';

describe('claimKey', () => {
  it('normalizes whitespace, case, and punctuation before hashing', () => {
    expect(normalizeClaimText('  Hello,   World! ')).toBe('hello world');
    expect(normalizeClaimText('喜欢简洁回复！')).toBe('喜欢简洁回复');
  });

  it('produces identical keys for identical normalized content', () => {
    expect(canonicalClaimKey('profile', 'Prefers concise replies.'))
      .toBe(canonicalClaimKey('profile', 'prefers  concise replies'));
  });

  it('produces different keys across kinds or contents', () => {
    expect(canonicalClaimKey('profile', 'same')).not.toBe(canonicalClaimKey('lesson', 'same'));
    expect(canonicalClaimKey('profile', 'a')).not.toBe(canonicalClaimKey('profile', 'b'));
  });

  it('hashes to a stable 8-hex-char digest', () => {
    expect(hashClaimText('stable')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashClaimText('stable')).toBe(hashClaimText('stable'));
  });

  it('rejects invalid keys and falls back to the canonical key', () => {
    expect(isValidClaimKey('')).toBe(false);
    expect(isValidClaimKey('has space')).toBe(false);
    expect(isValidClaimKey('a'.repeat(97))).toBe(false);
    expect(isValidClaimKey('user.language')).toBe(true);

    expect(resolveClaimKey(undefined, 'profile', 'fallback content'))
      .toBe(canonicalClaimKey('profile', 'fallback content'));
    expect(resolveClaimKey('  user.language  ', 'profile', 'x')).toBe('user.language');
  });

  it('sanitizes keyword lists: lowercases, trims, dedupes, caps at 8', () => {
    expect(sanitizeKeywords([' Pnpm ', 'pnpm', 3, '', '构建'])).toEqual(['pnpm', '构建']);
    expect(sanitizeKeywords(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])).toHaveLength(8);
    expect(sanitizeKeywords('not-an-array')).toEqual([]);
  });
});
