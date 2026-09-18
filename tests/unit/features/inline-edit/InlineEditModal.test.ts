import { createMockEl } from '@test/helpers/mockElement';
import type { App, Editor, MarkdownView } from 'obsidian';

import { InlineEditModal } from '@/features/inline-edit/InlineEditModal';
import type { InlineEditService } from '@/features/inline-edit/InlineEditService';
import type { EditorSelectionContext } from '@/utils/editor';

describe('InlineEditModal', () => {
  let mockApp: App;
  let mockEditor: jest.Mocked<Editor>;
  let mockView: MarkdownView;
  let mockService: jest.Mocked<InlineEditService>;

  beforeEach(() => {
    mockApp = {} as unknown as App;
    mockEditor = {
      getSelection: jest.fn().mockReturnValue('original code'),
      replaceSelection: jest.fn(),
      replaceRange: jest.fn(),
      getCursor: jest.fn().mockReturnValue({ line: 5, ch: 10 }),
    } as unknown as jest.Mocked<Editor>;

    mockView = {
      file: { path: 'Notes/Test.md' },
    } as unknown as MarkdownView;

    mockService = {
      generateEdit: jest.fn(),
    } as unknown as jest.Mocked<InlineEditService>;
  });

  function createModal(context?: EditorSelectionContext): InlineEditModal {
    const modal = new InlineEditModal({
      app: mockApp,
      editor: mockEditor,
      view: mockView,
      service: mockService,
      context,
    });
    (modal as any).contentEl = createMockEl();
    (modal as any).close = jest.fn();
    return modal;
  }

  it('renders input area and context badge for selection', () => {
    const context: EditorSelectionContext = {
      notePath: 'Notes/Test.md',
      mode: 'selection',
      selectedText: 'console.log("hello");',
      lineCount: 3,
      startLine: 1,
    };

    const modal = createModal(context);
    InlineEditModal.prototype.onOpen.call(modal);

    const input = (modal as any).contentEl.querySelector('.claudian-plus-inline-edit-input');
    expect(input).not.toBeNull();

    const badge = (modal as any).contentEl.querySelector('.claudian-plus-inline-edit-context-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('3');
  });

  it('renders input area and cursor badge when mode is cursor', () => {
    const context: EditorSelectionContext = {
      notePath: 'Notes/Test.md',
      mode: 'cursor',
      startLine: 5,
    };

    const modal = createModal(context);
    InlineEditModal.prototype.onOpen.call(modal);

    const badge = (modal as any).contentEl.querySelector('.claudian-plus-inline-edit-context-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('Cursor insertion point');
  });

  it('generates diff and renders diff lines on submission', async () => {
    mockService.generateEdit.mockResolvedValueOnce({
      originalText: 'line 1',
      replacementText: 'line 1 updated',
      diffLines: [
        { type: 'delete', text: 'line 1' },
        { type: 'insert', text: 'line 1 updated' },
      ],
    });

    const modal = createModal();
    InlineEditModal.prototype.onOpen.call(modal);

    const input = (modal as any).contentEl.querySelector('.claudian-plus-inline-edit-input');
    input.value = 'update line 1';

    // Simulate Enter key on input to start generation
    input.dispatchEvent({ type: 'keydown', key: 'Enter', shiftKey: false });

    // Allow promise tick
    await Promise.resolve();
    await Promise.resolve();

    expect(mockService.generateEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: 'update line 1',
      }),
      expect.anything()
    );

    const diffLines = (modal as any).contentEl.querySelectorAll('.claudian-plus-diff-line');
    expect(diffLines.length).toBe(2);
  });

  it('applies replacement to editor when accepted for selection mode', () => {
    const context: EditorSelectionContext = {
      notePath: 'Notes/Test.md',
      mode: 'selection',
      selectedText: 'old text',
    };

    const modal = createModal(context);
    (modal as any).currentResult = {
      originalText: 'old text',
      replacementText: 'new text',
      diffLines: [],
    };

    modal.acceptAndApply();

    expect(mockEditor.replaceSelection).toHaveBeenCalledWith('new text');
    expect((modal as any).close).toHaveBeenCalled();
  });

  it('applies replacement with exact selectionRange when present', () => {
    const context: EditorSelectionContext = {
      notePath: 'Notes/Test.md',
      mode: 'selection',
      selectedText: 'old text',
      selectionRange: {
        from: { line: 2, ch: 0 },
        to: { line: 2, ch: 8 },
      },
    };

    const modal = createModal(context);
    (modal as any).currentResult = {
      originalText: 'old text',
      replacementText: 'new text',
      diffLines: [],
    };

    modal.acceptAndApply();

    expect(mockEditor.replaceRange).toHaveBeenCalledWith('new text', { line: 2, ch: 0 }, { line: 2, ch: 8 });
    expect((modal as any).close).toHaveBeenCalled();
  });

  it('handles Mod+Enter keydown to accept preview', () => {
    const modal = createModal();
    InlineEditModal.prototype.onOpen.call(modal);

    const input = (modal as any).contentEl.querySelector('.claudian-plus-inline-edit-input');
    (modal as any).currentResult = {
      originalText: 'old text',
      replacementText: 'accepted text',
      diffLines: [],
    };

    const acceptSpy = jest.spyOn(modal, 'acceptAndApply');
    input.dispatchEvent({ type: 'keydown', key: 'Enter', ctrlKey: true });

    expect(acceptSpy).toHaveBeenCalled();
  });

  it('aborts and closes without modifying editor when rejected', () => {
    const modal = createModal();
    const abortSpy = jest.fn();
    (modal as any).abortController = { abort: abortSpy };

    modal.rejectAndClose();

    expect(abortSpy).toHaveBeenCalled();
    expect(mockEditor.replaceSelection).not.toHaveBeenCalled();
    expect(mockEditor.replaceRange).not.toHaveBeenCalled();
    expect((modal as any).close).toHaveBeenCalled();
  });
});
