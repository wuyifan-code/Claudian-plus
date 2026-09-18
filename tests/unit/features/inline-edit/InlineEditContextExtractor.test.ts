import type { Editor, MarkdownView } from 'obsidian';

import { InlineEditContextExtractor } from '@/features/inline-edit/InlineEditContextExtractor';

describe('InlineEditContextExtractor', () => {
  let mockEditor: Partial<Editor>;
  let mockView: Partial<MarkdownView>;

  beforeEach(() => {
    mockView = {
      file: {
        path: 'Research/Brainstorming.md',
      } as any,
    };
  });

  it('extracts selection context when text is highlighted', () => {
    mockEditor = {
      getSelection: jest.fn().mockReturnValue('const answer = 42;\nconsole.log(answer);'),
      getCursor: jest.fn((which?: string) => {
        if (which === 'from') return { line: 10, ch: 0 };
        if (which === 'to') return { line: 11, ch: 20 };
        return { line: 11, ch: 20 };
      }) as any,
    };

    const context = InlineEditContextExtractor.extract(mockEditor as Editor, mockView as MarkdownView);

    expect(context.mode).toBe('selection');
    expect(context.notePath).toBe('Research/Brainstorming.md');
    expect(context.selectedText).toBe('const answer = 42;\nconsole.log(answer);');
    expect(context.startLine).toBe(11);
    expect(context.lineCount).toBe(2);
  });

  it('extracts cursor context when no text is selected', () => {
    const lines = [
      '# Introduction',
      'This is a note about artificial intelligence.',
      'Here is the next section.',
    ];

    mockEditor = {
      getSelection: jest.fn().mockReturnValue(''),
      getCursor: jest.fn().mockReturnValue({ line: 1, ch: 10 }),
      lineCount: jest.fn().mockReturnValue(lines.length),
      getLine: jest.fn((line: number) => lines[line]),
    };

    const context = InlineEditContextExtractor.extract(mockEditor as Editor, mockView as MarkdownView);

    expect(context.mode).toBe('cursor');
    expect(context.notePath).toBe('Research/Brainstorming.md');
    expect(context.startLine).toBe(2);
    expect(context.cursorContext).toBeDefined();
    expect(context.cursorContext?.line).toBe(1);
    expect(context.cursorContext?.column).toBe(10);
    expect(context.cursorContext?.beforeCursor).toBe('This is a ');
    expect(context.cursorContext?.afterCursor).toBe('note about artificial intelligence.');
  });
});
