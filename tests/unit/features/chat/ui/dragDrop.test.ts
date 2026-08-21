import { TFile, TFolder } from 'obsidian';

import {
  buildDroppedMention,
  extractDroppedPaths,
  resolveDroppedVaultItems,
} from '@/features/chat/ui/dragDrop';

// Vault resolution goes through Node's path module, so fixtures must follow
// the host platform's path style to stay valid on Linux CI.
const isWindows = process.platform === 'win32';
const vaultRoot = isWindows ? 'C:/Vault' : '/vault';
const insideFilePath = `${vaultRoot}/Notes/One.md`;
const outsidePath = isWindows ? 'C:/Other/nope' : '/other/nope';
const nativeFilePath = `${vaultRoot}/Notes/Three.md`;
const nativeFileUri = isWindows
  ? 'file:///C:/Vault/Notes/Project%20Plan.md'
  : 'file:///vault/Notes/Project%20Plan.md';

function createDataTransfer(data: Record<string, string>, files: Array<{ path?: string }> = []): DataTransfer {
  return {
    getData: (type: string) => data[type] ?? '',
    files,
  } as unknown as DataTransfer;
}

describe('drag and drop vault context helpers', () => {
  it('extracts paths from Obsidian URI, JSON, and native file payloads', () => {
    const dataTransfer = createDataTransfer(
      {
        'text/uri-list': 'obsidian://open?vault=Creative%20Vault&file=Notes%2FOne.md',
        'application/json': JSON.stringify({ paths: ['Notes/Two.md', 'Projects'] }),
      },
      [{ path: nativeFilePath }],
    );

    expect(extractDroppedPaths(dataTransfer)).toEqual([
      'Notes/Two.md',
      'Projects',
      'Notes/One.md',
      nativeFilePath,
    ]);
  });

  it('normalizes a native Windows file URI to a drive path', () => {
    const dataTransfer = createDataTransfer({
      'text/uri-list': 'file:///C:/Vault/Notes/Project%20Plan.md',
    });

    expect(extractDroppedPaths(dataTransfer)).toEqual(['C:/Vault/Notes/Project Plan.md']);
  });

  it('resolves only files and folders that belong to the current vault', () => {
    const files = {
      'Notes/One.md': new (TFile as any)('Notes/One.md'),
      Projects: new (TFolder as any)('Projects'),
    };
    const app = {
      vault: {
        adapter: { basePath: vaultRoot },
        getAbstractFileByPath: (path: string) => files[path as keyof typeof files] ?? null,
      },
    } as any;

    expect(resolveDroppedVaultItems(app, [insideFilePath, 'Projects', outsidePath])).toEqual([
      { kind: 'file', path: 'Notes/One.md' },
      { kind: 'folder', path: 'Projects' },
    ]);
  });

  it('resolves a native file URI against the vault', () => {
    const dataTransfer = createDataTransfer({
      'text/uri-list': nativeFileUri,
    });
    const app = {
      vault: {
        adapter: { basePath: vaultRoot },
        getAbstractFileByPath: (path: string) =>
          path === 'Notes/Project Plan.md' ? new (TFile as any)(path) : null,
      },
    } as any;

    const rawPaths = extractDroppedPaths(dataTransfer);
    expect(rawPaths).toEqual([`${vaultRoot}/Notes/Project Plan.md`]);
    expect(resolveDroppedVaultItems(app, rawPaths)).toEqual([
      { kind: 'file', path: 'Notes/Project Plan.md' },
    ]);
  });

  it('formats dropped items as composer mentions', () => {
    expect(buildDroppedMention({ kind: 'file', path: 'Notes/One.md' })).toBe('@Notes/One.md ');
    expect(buildDroppedMention({ kind: 'folder', path: 'Projects' })).toBe('@Projects/ ');
  });
});
