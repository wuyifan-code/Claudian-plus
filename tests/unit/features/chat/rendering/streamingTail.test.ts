import { canAppendAsText, isPlainTextTail } from '@/features/chat/rendering/streamingTail';

describe('isPlainTextTail', () => {
  it('accepts plain prose', () => {
    expect(isPlainTextTail('The quick brown fox jumps over the lazy dog')).toBe(true);
    expect(isPlainTextTail('这是一段纯中文，包含全角标点符号。')).toBe(true);
    expect(isPlainTextTail('a - b and C++ are ordinary prose')).toBe(true);
    expect(isPlainTextTail('')).toBe(true);
  });

  it.each([
    ['**bold**', 'strong emphasis'],
    ['a `code span`', 'inline code'],
    ['a [link](https://example.com)', 'link'],
    ['![image](path/to.png)', 'image'],
    ['$x^2$', 'inline math'],
    ['<div>x</div>', 'raw html'],
    ['a &amp; b', 'character entity'],
    ['a \\* b', 'escaped syntax'],
    ['~~strike~~', 'strikethrough'],
    ['| a | b |', 'table row'],
    ['# heading', 'atx heading'],
    ['- item', 'bullet list'],
    ['+ item', 'plus list'],
    ['1. item', 'ordered list'],
    ['> quote', 'blockquote'],
    ['---', 'thematic break'],
    ['line one\nline two', 'soft line break'],
    ['    indented', 'indented code block'],
  ])('rejects %s (%s)', (tail) => {
    expect(isPlainTextTail(tail)).toBe(false);
  });

  it('rejects any tail containing syntax after plain text', () => {
    expect(isPlainTextTail('Some prose then **bold start')).toBe(false);
  });
});

describe('canAppendAsText', () => {
  it('accepts a plain delta on a plain tail', () => {
    expect(canAppendAsText('The quick brown', ' fox')).toBe(true);
    expect(canAppendAsText('', 'Hello')).toBe(true);
  });

  it('accepts a delta that only contains ordinary punctuation', () => {
    expect(canAppendAsText('a', ' - b')).toBe(true);
    expect(canAppendAsText('C', '++')).toBe(true);
  });

  it('rejects a delta with inline syntax', () => {
    expect(canAppendAsText('Some prose', ' with **bold')).toBe(false);
    expect(canAppendAsText('Some prose', ' and `code')).toBe(false);
    expect(canAppendAsText('Some prose', ' and $math')).toBe(false);
  });

  it('rejects a delta with a line break', () => {
    expect(canAppendAsText('Some prose', '\nnext line')).toBe(false);
  });

  it('rejects when the existing tail is no longer plain', () => {
    expect(canAppendAsText('Some **bold** tail', ' more')).toBe(false);
  });

  it('rejects an empty delta', () => {
    expect(canAppendAsText('text', '')).toBe(false);
  });
});
