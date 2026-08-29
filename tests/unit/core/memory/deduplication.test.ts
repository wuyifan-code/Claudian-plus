import {
  deduplicateMemoryEntries,
  isMemoryDuplicate,
  normalizeMemoryContent,
} from '@/core/memory/deduplication';

describe('deduplication utility', () => {
  describe('normalizeMemoryContent', () => {
    it('trims leading and trailing whitespace and converts to lowercase', () => {
      expect(normalizeMemoryContent('   Hello World  ')).toBe('hello world');
    });

    it('collapses multiple whitespace characters into a single space', () => {
      expect(normalizeMemoryContent('Always\n\t  use   TypeScript\r\n')).toBe('always use typescript');
    });

    it('handles empty string gracefully', () => {
      expect(normalizeMemoryContent('')).toBe('');
      expect(normalizeMemoryContent('   ')).toBe('');
    });
  });

  describe('isMemoryDuplicate', () => {
    it('detects exact string matches (case and whitespace insensitive)', () => {
      const existing = ['always use pnpm', 'prefer functional style'];
      expect(isMemoryDuplicate('Always   use PNPM', existing)).toBe(true);
      expect(isMemoryDuplicate('prefer OOP style', existing)).toBe(false);
    });

    it('detects duplicate against objects with content property', () => {
      const existing = [
        { content: 'Always write tests first' },
        { content: 'Never use console.log' },
      ];
      expect(isMemoryDuplicate('always write tests first', existing)).toBe(true);
      expect(isMemoryDuplicate('Always write docs first', existing)).toBe(false);
    });

    it('detects containment match for strings of length >= 10', () => {
      const existing = ['always use typescript for all source files'];
      // Candidate contains existing
      expect(isMemoryDuplicate('Please always use typescript for all source files in this repo', existing)).toBe(true);
      // Existing contains candidate (candidate >= 10 chars)
      expect(isMemoryDuplicate('always use typescript', existing)).toBe(true);
    });

    it('does not trigger containment match for short strings (< 10 chars) to prevent false positives', () => {
      const existing = ['React'];
      expect(isMemoryDuplicate('Re', existing)).toBe(false);
      expect(isMemoryDuplicate('React is great', existing)).toBe(false);
    });

    it('returns false when existing list is empty or candidate is empty', () => {
      expect(isMemoryDuplicate('some content', [])).toBe(false);
      expect(isMemoryDuplicate('', ['some content'])).toBe(false);
      expect(isMemoryDuplicate('   ', ['some content'])).toBe(false);
    });
  });

  describe('deduplicateMemoryEntries', () => {
    it('removes duplicate entries based on normalized content', () => {
      const entries = [
        { id: '1', content: 'Always use PNPM' },
        { id: '2', content: 'always   use pnpm' },
        { id: '3', content: 'Prefer dark mode' },
        { id: '4', content: 'PREFER DARK MODE' },
        { id: '5', content: 'Different rule here' },
      ];

      const deduped = deduplicateMemoryEntries(entries, (e) => e.content);
      expect(deduped).toHaveLength(3);
      expect(deduped.map((e) => e.id)).toEqual(['1', '3', '5']);
    });
  });
});
