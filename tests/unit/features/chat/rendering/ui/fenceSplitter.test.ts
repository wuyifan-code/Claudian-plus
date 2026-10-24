import { hasUiFence, splitUiFences } from '@/features/chat/rendering/ui/fenceSplitter';

describe('splitUiFences', () => {
  it('returns the input unchanged when there is no fence at all', () => {
    const markdown = 'Plain **markdown** with `inline code`.';
    const parts = splitUiFences(markdown);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ kind: 'markdown', content: markdown });
  });

  it('leaves math, image embeds and wikilinks byte-identical', () => {
    // The splitter runs before LaTeX normalisation and HTML escaping, so this
    // identity guarantee is what keeps those pipelines working unchanged.
    const markdown = [
      'Energy is $E = mc^2$ inline.',
      '',
      '$$',
      '\\int_0^1 x^2 dx',
      '$$',
      '',
      '![[diagram.png|320]]',
      'See [[Meeting notes]] for context.',
    ].join('\n');

    const parts = splitUiFences(markdown);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ kind: 'markdown', content: markdown });
    expect(hasUiFence(markdown)).toBe(false);
  });

  it('splits a single ui fence into prose, program and prose', () => {
    const markdown = ['Before.', '', '```claudian-ui', 'root = Col([])', '```', '', 'After.'].join('\n');
    const parts = splitUiFences(markdown);

    expect(parts.map((part) => part.kind)).toEqual(['markdown', 'ui', 'markdown']);

    const [before, ui, after] = parts;
    expect(before?.kind === 'markdown' && before.content).toBe('Before.\n');
    expect(ui?.kind === 'ui' && ui.content).toBe('root = Col([])');
    expect(ui?.kind === 'ui' && ui.closed).toBe(true);
    expect(after?.kind === 'markdown' && after.content).toBe('\nAfter.');
    expect(hasUiFence(markdown)).toBe(true);
  });

  it('treats other fenced code blocks as markdown', () => {
    const markdown = ['```ts', 'const a = 1;', '```'].join('\n');
    const parts = splitUiFences(markdown);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.kind).toBe('markdown');
    expect(parts[0]?.kind === 'markdown' && parts[0].content).toBe(markdown);
  });

  it('does not open a ui segment for a fence nested in another code block', () => {
    const markdown = ['```markdown', '```claudian-ui', 'root = Col([])', '```', '```'].join('\n');
    const parts = splitUiFences(markdown);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.kind).toBe('markdown');
  });

  it('keeps an unclosed ui fence so streaming renders partial output', () => {
    const markdown = ['Intro', '```claudian-ui', 'root = Col([title])', 'title = Title("Hi"'].join('\n');
    const parts = splitUiFences(markdown);
    const ui = parts.find((part) => part.kind === 'ui');

    expect(ui).toBeDefined();
    expect(ui?.kind === 'ui' && ui.closed).toBe(false);
    expect(ui?.kind === 'ui' && ui.content).toContain('root = Col([title])');
  });

  it('supports the openui alias and tilde fences', () => {
    expect(hasUiFence(['```openui', 'root = Col([])', '```'].join('\n'))).toBe(true);
    expect(hasUiFence(['~~~claudian-ui', 'root = Col([])', '~~~'].join('\n'))).toBe(true);
  });

  it('never drops prose surrounding consecutive ui fences', () => {
    const markdown = [
      'A',
      '```claudian-ui',
      'root = Col([])',
      '```',
      'B',
      '```claudian-ui',
      'root = Col([])',
      '```',
      'C',
    ].join('\n');
    const parts = splitUiFences(markdown);

    expect(parts.map((part) => part.kind)).toEqual(['markdown', 'ui', 'markdown', 'ui', 'markdown']);
    const reconstructed = parts.map((part) => part.content).join('');
    expect(reconstructed).toContain('A');
    expect(reconstructed).toContain('B');
    expect(reconstructed).toContain('C');
  });

  describe('bare fence sniffing (model forgets the claudian-ui tag)', () => {
    it('treats a bare fence whose first line is `root =` as a UI program', () => {
      const markdown = ['```', 'root = Col([Title("hi")])', '```'].join('\n');
      const parts = splitUiFences(markdown);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ kind: 'ui', language: '', closed: true });
      expect(parts[0].content).toBe('root = Col([Title("hi")])');
    });

    it('leaves a bare fence with non-program content as a plain code block', () => {
      const markdown = ['```', 'const x = 1;', '```'].join('\n');
      const parts = splitUiFences(markdown);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toEqual({ kind: 'markdown', content: markdown });
      expect(hasUiFence(markdown)).toBe(false);
    });

    it('does not sniff tagged fences: ```js with root inside stays a code block', () => {
      const markdown = ['```js', 'root = Col([])', '```'].join('\n');
      const parts = splitUiFences(markdown);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toEqual({ kind: 'markdown', content: markdown });
    });

    it('keeps a partial bare-fence program while streaming (unclosed)', () => {
      const markdown = ['```', 'root = Col([', '  Title("hi"),'].join('\n');
      const parts = splitUiFences(markdown);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ kind: 'ui', language: '', closed: false });
    });

    it('does not sniff when the line after a bare fence is blank', () => {
      const markdown = ['```', '', 'root = Col([])', '```'].join('\n');
      const parts = splitUiFences(markdown);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toEqual({ kind: 'markdown', content: markdown });
    });
  });
});
