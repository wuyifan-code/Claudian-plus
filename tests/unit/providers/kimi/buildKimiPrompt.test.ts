import { buildKimiPromptBlocks, buildKimiPromptText } from '@/providers/kimi/runtime/buildKimiPrompt';

describe('buildKimiPromptText', () => {
  it('appends memory and consciousness appendices as a system context prefix', () => {
    const prompt = buildKimiPromptText(
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
    const prompt = buildKimiPromptText({ text: 'Hi' }, [], []);
    expect(prompt).not.toContain('<system_context>');
    expect(prompt).toBe('Hi');
  });

  it('appends current note and editor selection context', () => {
    const prompt = buildKimiPromptText({
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
    const prompt = buildKimiPromptText(
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

describe('buildKimiPromptBlocks', () => {
  it('emits text and image blocks', () => {
    const blocks = buildKimiPromptBlocks({
      text: 'Look at this',
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
    expect(blocks[0]).toEqual({ type: 'text', text: 'Look at this' });
    expect(blocks[1]).toEqual({ data: 'base64data', mimeType: 'image/png', type: 'image' });
  });

  it('skips images without data', () => {
    const blocks = buildKimiPromptBlocks({
      text: 'Hi',
      images: [
        {
          data: '',
          id: 'img-1',
          mediaType: 'image/png',
          name: 'a.png',
          size: 10,
          source: 'paste',
        },
      ],
    });
    expect(blocks).toHaveLength(1);
  });
});
