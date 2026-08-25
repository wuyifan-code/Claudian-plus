/** @jest-environment jsdom */
import {
  createLinkedNote,
  getSelectedTextWithin,
  insertAtCursor,
  insertCodeBlockAtCursor,
  openDiffReview,
  replaceSelection,
} from '../../../../../src/features/chat/actions/ActionableOutputController';

describe('ActionableOutputController', () => {
  it('insertAtCursor inserts text at active editor cursor', () => {
    let insertedText = '';
    let replacedRange: any = null;
    let newCursorPos: any = null;

    const mockEditor = {
      getCursor: () => ({ line: 2, ch: 5 }),
      replaceRange: (text: string, pos: any) => {
        insertedText = text;
        replacedRange = pos;
      },
      setCursor: (pos: any) => {
        newCursorPos = pos;
      },
    };

    const mockApp = {
      workspace: {
        getActiveViewOfType: jest.fn().mockReturnValue({ editor: mockEditor }),
      },
    } as any;

    const success = insertAtCursor(mockApp, 'Hello world');
    expect(success).toBe(true);
    expect(insertedText).toBe('Hello world');
    expect(replacedRange).toEqual({ line: 2, ch: 5 });
    expect(newCursorPos).toEqual({ line: 2, ch: 16 });
  });

  it('replaceSelection replaces active selection when present', () => {
    let replacedSelection = '';

    const mockEditor = {
      getSelection: () => 'some old text',
      replaceSelection: (text: string) => {
        replacedSelection = text;
      },
      lineCount: () => 10,
    };

    const mockApp = {
      workspace: {
        getActiveViewOfType: jest.fn().mockReturnValue({ editor: mockEditor }),
      },
    } as any;

    const success = replaceSelection(mockApp, 'new replacement text');
    expect(success).toBe(true);
    expect(replacedSelection).toBe('new replacement text');
  });

  it('replaceSelection replaces focused section range when selection is empty', () => {
    let replacedText = '';
    let fromRange: any = null;
    let toRange: any = null;

    const mockEditor = {
      getSelection: () => '',
      replaceRange: (text: string, from: any, to: any) => {
        replacedText = text;
        fromRange = from;
        toRange = to;
      },
      lineCount: () => 20,
    };

    const mockApp = {
      workspace: {
        getActiveViewOfType: jest.fn().mockReturnValue({ editor: mockEditor }),
      },
    } as any;

    const focusContext: any = {
      type: 'section',
      range: { startLine: 5, endLine: 12 },
    };

    const success = replaceSelection(mockApp, 'new section body', focusContext);
    expect(success).toBe(true);
    expect(replacedText).toBe('new section body');
    expect(fromRange).toEqual({ line: 4, ch: 0 });
    expect(toRange).toEqual({ line: 12, ch: 0 });
  });

  it('createLinkedNote extracts title from markdown heading and creates file in vault', async () => {
    let createdPath = '';
    let createdContent = '';
    let openedFile: any = null;

    const mockVault = {
      getAbstractFileByPath: jest.fn().mockReturnValue(null),
      create: jest.fn().mockImplementation(async (path: string, content: string) => {
        createdPath = path;
        createdContent = content;
        return { path, basename: 'My Idea' };
      }),
    };

    const mockWorkspace = {
      getActiveFile: () => ({ parent: { path: 'Folder' } }),
      getActiveViewOfType: () => null,
      getLeaf: () => ({
        openFile: async (file: any) => {
          openedFile = file;
        },
      }),
    };

    const mockApp = {
      vault: mockVault,
      workspace: mockWorkspace,
    } as any;

    const markdown = '# My Idea\n\nThis is a detailed analysis.';
    const resultPath = await createLinkedNote(mockApp, markdown);

    expect(resultPath).toBe('Folder/My Idea.md');
    expect(createdPath).toBe('Folder/My Idea.md');
    expect(createdContent).toBe(markdown);
    expect(openedFile).toEqual({ path: 'Folder/My Idea.md', basename: 'My Idea' });
  });

  it('openDiffReview opens modal with diff review', () => {
    const mockApp = {
      workspace: {
        getActiveViewOfType: jest.fn().mockReturnValue({
          editor: { getValue: () => 'original' },
          file: { path: 'test.md' },
        }),
      },
    } as any;

    const success = openDiffReview(mockApp, 'modified', 'original');
    expect(success).toBe(true);
  });

  describe('getSelectedTextWithin', () => {
    it('returns null when there is no selection or selection is collapsed', () => {
      const container = document.createElement('div');
      const originalGetSelection = window.getSelection;
      window.getSelection = jest.fn().mockReturnValue({
        isCollapsed: true,
        rangeCount: 0,
        toString: () => '',
      });

      expect(getSelectedTextWithin(container)).toBeNull();

      window.getSelection = originalGetSelection;
    });

    it('returns selected text when range intersects container', () => {
      const container = document.createElement('div');
      container.textContent = 'Full paragraph with useful selection inside.';

      const originalGetSelection = window.getSelection;
      window.getSelection = jest.fn().mockReturnValue({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => ({
          commonAncestorContainer: container,
          startContainer: container,
          endContainer: container,
        }),
        toString: () => 'useful selection',
      });

      expect(getSelectedTextWithin(container)).toBe('useful selection');

      window.getSelection = originalGetSelection;
    });

    it('returns null when selected text is outside container', () => {
      const container = document.createElement('div');
      const otherContainer = document.createElement('div');

      const originalGetSelection = window.getSelection;
      window.getSelection = jest.fn().mockReturnValue({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => ({
          commonAncestorContainer: otherContainer,
          startContainer: otherContainer,
          endContainer: otherContainer,
        }),
        toString: () => 'outside selection',
      });

      expect(getSelectedTextWithin(container)).toBeNull();

      window.getSelection = originalGetSelection;
    });
  });

  describe('insertCodeBlockAtCursor', () => {
    it('formats code with language tag and inserts at cursor', () => {
      let insertedText = '';

      const mockEditor = {
        getCursor: () => ({ line: 0, ch: 0 }),
        replaceRange: (text: string) => {
          insertedText = text;
        },
        setCursor: jest.fn(),
      };

      const mockApp = {
        workspace: {
          getActiveViewOfType: jest.fn().mockReturnValue({ editor: mockEditor }),
        },
      } as any;

      const result = insertCodeBlockAtCursor(mockApp, 'console.log("hello");', 'typescript');

      expect(result).toBe(true);
      expect(insertedText).toBe('```typescript\nconsole.log("hello");\n```\n');
    });

    it('formats code without language when none provided', () => {
      let insertedText = '';

      const mockEditor = {
        getCursor: () => ({ line: 0, ch: 0 }),
        replaceRange: (text: string) => {
          insertedText = text;
        },
        setCursor: jest.fn(),
      };

      const mockApp = {
        workspace: {
          getActiveViewOfType: jest.fn().mockReturnValue({ editor: mockEditor }),
        },
      } as any;

      const result = insertCodeBlockAtCursor(mockApp, 'plain text code');

      expect(result).toBe(true);
      expect(insertedText).toBe('```\nplain text code\n```\n');
    });
  });
});

