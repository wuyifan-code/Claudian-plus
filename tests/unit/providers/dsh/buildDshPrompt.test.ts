import { buildDshPromptBlocks, buildDshPromptText } from '@/providers/dsh/runtime/buildDshPrompt';

describe('buildDshPromptText', () => {
  it('appends memory and consciousness appendices as a system context prefix', () => {
    const prompt = buildDshPromptText(
      { text: 'Explain this' },
      [],
      ['<memory>remembered fact</memory>', '<awareness>profile</awareness>'],
    );
    expect(prompt).toContain('<system_context>');
    expect(prompt).toContain('<memory>remembered fact</memory>');
    expect(prompt).toContain('<awareness>profile</awareness>');
    expect(prompt).toContain('</system_context>');
    expect(prompt).toContain('Explain this');
  });

  it('omits the system prefix when there are no appendices', () => {
    expect(buildDshPromptText({ text: 'Hi' }, [], [])).toBe('Hi');
  });

  it('appends current note and editor selection context', () => {
    const prompt = buildDshPromptText({
      text: 'Fix this',
      currentNotePath: 'notes/a.md',
      editorSelection: {
        mode: 'selection',
        notePath: 'notes/a.md',
        selectedText: 'broken',
      },
    });
    expect(prompt).toContain('<linked_note>');
    expect(prompt).toContain('<editor_selection');
  });

  it('rebuilds conversation context when history is provided', () => {
    const prompt = buildDshPromptText(
      { text: 'Continue' },
      [
        {
          content: 'Earlier message',
          id: 'user-1',
          role: 'user',
          timestamp: 1,
        },
      ],
    );
    expect(prompt).toContain('Earlier message');
    expect(prompt).toContain('Continue');
  });
});

describe('buildDshPromptBlocks', () => {
  it('emits a single text block and never image blocks (baseline prompts only)', () => {
    const blocks = buildDshPromptBlocks({
      text: 'Hi',
      images: [
        {
          data: 'base64data',
          id: 'img-1',
          mediaType: 'image/png',
          name: 'a.png',
          size: 10,
          source: 'paste',
        },
      ],
    });
    expect(blocks).toEqual([{ type: 'text', text: 'Hi' }]);
  });
});
