import { createMockEl } from '@test/helpers/mockElement';
import { TFile } from 'obsidian';

import { CanvasNeighborsModal } from '@/features/chat/CanvasNeighborsModal';
import { confirm } from '@/shared/modals/ConfirmModal';

jest.mock('@/shared/modals/ConfirmModal', () => ({
  confirm: jest.fn(),
}));

const mockConfirm = confirm as jest.MockedFunction<typeof confirm>;

function makeFile(path: string): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  Object.assign(file, { path, extension: 'md' });
  return file;
}

describe('CanvasNeighborsModal batch insertion', () => {
  beforeEach(() => {
    mockConfirm.mockReset();
  });

  it('confirms, inserts visible candidates in one editor operation, and safely undoes it', async () => {
    mockConfirm.mockResolvedValue(true);
    const destination = makeFile('notes/neighbor.md');
    let value = 'Current note';
    const editor = {
      getValue: jest.fn(() => value),
      getCursor: jest.fn(() => ({ line: 0, ch: value.length })),
      replaceRange: jest.fn((replacement: string) => { value += replacement; }),
      undo: jest.fn(() => { value = 'Current note'; }),
    };
    const modal = Object.create(CanvasNeighborsModal.prototype) as any;
    modal.app = {
      metadataCache: {
        resolvedLinks: { 'notes/source.md': {} },
        fileToLinktext: jest.fn(() => 'notes/neighbor'),
      },
      vault: {
        getAbstractFileByPath: jest.fn(() => destination),
      },
      workspace: {
        activeEditor: { editor, file: { path: 'notes/source.md' } },
      },
    };
    modal.suggestions = [{
      path: 'notes/neighbor.md',
      relation: 'outgoing',
      linkCount: 1,
      via: ['notes/source.md'],
    }];
    modal.batchUndoButton = createMockEl();

    await modal.insertAllLinks();

    expect(mockConfirm).toHaveBeenCalledWith(
      modal.app,
      'Insert 1 neighbor link into the active note?',
      'Insert links',
    );
    expect(editor.replaceRange).toHaveBeenCalledWith(
      '\n- [[notes/neighbor]]\n',
      { line: 0, ch: 'Current note'.length },
      undefined,
      'Claudian Plus: insert Canvas neighbor links',
    );

    modal.undoBatchInsert();
    expect(editor.undo).toHaveBeenCalledTimes(1);
    expect(value).toBe('Current note');
  });

  it('does not write if the note changes while confirmation is open', async () => {
    let value = 'Current note';
    mockConfirm.mockImplementation(async () => {
      value = 'User edit';
      return true;
    });
    const destination = makeFile('neighbor.md');
    const editor = {
      getValue: jest.fn(() => value),
      getCursor: jest.fn(() => ({ line: 0, ch: value.length })),
      replaceRange: jest.fn(),
      undo: jest.fn(),
    };
    const modal = Object.create(CanvasNeighborsModal.prototype) as any;
    modal.app = {
      metadataCache: {
        resolvedLinks: { 'source.md': {} },
        fileToLinktext: jest.fn(() => 'neighbor'),
      },
      vault: { getAbstractFileByPath: jest.fn(() => destination) },
      workspace: { activeEditor: { editor, file: { path: 'source.md' } } },
    };
    modal.suggestions = [{ path: 'neighbor.md', relation: 'incoming', linkCount: 1, via: ['source.md'] }];
    modal.batchUndoButton = createMockEl();

    await modal.insertAllLinks();

    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(value).toBe('User edit');
  });
});
