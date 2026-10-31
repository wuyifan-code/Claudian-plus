import { findCommitBoundary } from '@/features/chat/rendering/streamingMarkdownSplit';

describe('findCommitBoundary', () => {
  it('returns 0 before any blank line', () => {
    expect(findCommitBoundary('one paragraph')).toBe(0);
  });

  it('commits through the last blank line', () => {
    expect(findCommitBoundary('first\n\nsecond')).toBe(7);
  });

  it('keeps the trailing open block out of the commit', () => {
    const text = 'a\n\nb\n\nc';
    expect(findCommitBoundary(text)).toBe(6);
  });

  it('commits everything when the buffer ends on a blank line', () => {
    expect(findCommitBoundary('a\n\n')).toBe(3);
  });

  it('ignores blank lines inside a fenced block', () => {
    const text = 'intro\n\n```\ncode\n\ncode\n```\nafter';
    expect(findCommitBoundary(text)).toBe(7);
  });

  it('resumes committing after the fence closes', () => {
    const text = 'intro\n\n```\ncode\n```\n\noutro';
    expect(findCommitBoundary(text)).toBe(21);
  });

  it('handles tilde fences', () => {
    const text = 'a\n\n~~~\nx\n\ny\n~~~';
    expect(findCommitBoundary(text)).toBe(3);
  });

  it('treats an unclosed fence as open to the end', () => {
    const text = 'a\n\n```\nstill streaming\n\nmore';
    expect(findCommitBoundary(text)).toBe(3);
  });

  it('never returns an offset past the buffer', () => {
    const text = 'a\n\n';
    expect(findCommitBoundary(text)).toBeLessThanOrEqual(text.length);
  });
});
