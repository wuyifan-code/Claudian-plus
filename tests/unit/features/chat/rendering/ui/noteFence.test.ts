import {
  buildUiEmbedFence,
  buildUiEmbedInsertion,
  MAX_UI_EMBED_CHARS,
  noteUiBlockKey,
  noteUiBlockKeyPrefix,
  UI_EMBED_LANGUAGES,
} from '@/features/chat/rendering/ui/noteFence';

const BT = String.fromCharCode(96);
const FENCE = BT.repeat(3);

describe('note embed fences', () => {
  it('wraps a program in a claudian-ui fence', () => {
    expect(buildUiEmbedFence('root = Text("hi")')).toBe(
      FENCE + 'claudian-ui\nroot = Text("hi")\n' + FENCE + '\n',
    );
  });

  it('grows the marker past any backtick run inside the program', () => {
    const program = 'root = Markdown("' + BT.repeat(4) + 'js")';
    const fence = buildUiEmbedFence(program);
    const marker = BT.repeat(5);
    expect(fence.startsWith(marker + 'claudian-ui\n')).toBe(true);
    expect(fence.endsWith('\n' + marker + '\n')).toBe(true);
  });

  it('normalizes line endings and trailing whitespace', () => {
    const fence = buildUiEmbedFence('root = Text("a")\r\n\r\n');
    expect(fence).not.toContain('\r');
    expect(fence).toBe(FENCE + 'claudian-ui\nroot = Text("a")\n' + FENCE + '\n');
  });

  it('refuses to build a fence from an empty program', () => {
    expect(buildUiEmbedFence('')).toBe('');
    expect(buildUiEmbedFence('   \n  ')).toBe('');
  });

  it('separates the fence from a non-empty cursor line', () => {
    const fence = FENCE + 'claudian-ui\nroot = Text("x")\n' + FENCE + '\n';
    expect(buildUiEmbedInsertion('', fence)).toBe(fence);
    expect(buildUiEmbedInsertion('   ', fence)).toBe(fence);
    expect(buildUiEmbedInsertion('some text', fence)).toBe('\n\n' + fence);
    expect(buildUiEmbedInsertion('text', '')).toBe('');
  });

  it('keys blocks by note, content and occurrence', () => {
    const prefix = noteUiBlockKeyPrefix('Notes/a.md', 'abc');
    expect(prefix).toBe('note:Notes/a.md:abc:');
    expect(noteUiBlockKey('Notes/a.md', 'abc', 0)).toBe(prefix + '0');
    expect(noteUiBlockKey('Notes/a.md', 'abc', 1)).not.toBe(noteUiBlockKey('Notes/a.md', 'abc', 0));
    expect(noteUiBlockKey('Notes/b.md', 'abc', 0)).not.toBe(noteUiBlockKey('Notes/a.md', 'abc', 0));
  });

  it('exposes the supported languages and the size guard', () => {
    expect([...UI_EMBED_LANGUAGES]).toEqual(['claudian-ui', 'openui']);
    expect(MAX_UI_EMBED_CHARS).toBe(200000);
  });
});
