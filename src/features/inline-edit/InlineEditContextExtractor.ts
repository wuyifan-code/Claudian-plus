import type { Editor, MarkdownView } from 'obsidian';

import { buildCursorContext, type EditorSelectionContext } from '../../utils/editor';

export class InlineEditContextExtractor {
  static extract(editor: Editor, view?: MarkdownView | null): EditorSelectionContext {
    const notePath = view?.file?.path ?? '';
    const selectedText = editor.getSelection();

    if (selectedText && selectedText.length > 0) {
      const from = editor.getCursor('from');
      const to = editor.getCursor('to');
      const lineCount = Math.abs(to.line - from.line) + 1;
      return {
        notePath,
        mode: 'selection',
        selectedText,
        startLine: Math.min(from.line, to.line) + 1,
        lineCount,
        selectionRange: { from, to },
      };
    }

    const cursor = editor.getCursor();
    const lineCount = editor.lineCount();
    const cursorContext = buildCursorContext(
      (line: number) => editor.getLine(line),
      lineCount,
      cursor.line,
      cursor.ch
    );

    return {
      notePath,
      mode: 'cursor',
      cursorContext,
      startLine: cursor.line + 1,
      lineCount: 1,
    };
  }
}
