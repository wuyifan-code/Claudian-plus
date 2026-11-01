import { type App, MarkdownRenderer } from 'obsidian';

import { createVaultUiRenderHost } from '@/features/chat/rendering/ui/vaultUiHost';

interface FakeApp {
  metadataCache: {
    getFirstLinkpathDest: jest.Mock;
    getFileCache: jest.Mock;
  };
  vault: {
    cachedRead: jest.Mock;
    adapter: { getResourcePath: jest.Mock };
  };
  workspace: {
    openLinkText: jest.Mock;
    revealLeaf: jest.Mock;
    getLeavesOfType: jest.Mock;
  };
}

function createApp(): FakeApp {
  return {
    metadataCache: {
      getFirstLinkpathDest: jest.fn((linktext: string) => (
        linktext === 'missing' ? null : { path: 'resolved/' + linktext, basename: linktext }
      )),
      getFileCache: jest.fn(() => ({
        tags: [{ tag: '#x' }, { tag: '#x' }, { tag: '' }, { tag: '#y' }],
      })),
    },
    vault: {
      cachedRead: jest.fn(async () => '---\ntitle: x\n---\n\n# Heading\n\nFirst line\nsecond'),
      adapter: { getResourcePath: jest.fn((path: string) => 'app://' + path) },
    },
    workspace: {
      openLinkText: jest.fn(),
      revealLeaf: jest.fn(async () => undefined),
      getLeavesOfType: jest.fn(() => []),
    },
  };
}

describe('createVaultUiRenderHost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves notes relative to the source path and reports missing ones', () => {
    const app = createApp();
    const host = createVaultUiRenderHost(app as unknown as App, {
      sourcePath: 'Notes/embed.md',
      component: { addChild: jest.fn() } as never,
    });

    expect(host.noteExists?.('target')).toBe(true);
    expect(host.noteExists?.('missing')).toBe(false);
    expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('target', 'Notes/embed.md');
  });

  it('opens notes relative to the source path', () => {
    const app = createApp();
    const host = createVaultUiRenderHost(app as unknown as App, {
      sourcePath: 'Notes/embed.md',
      component: { addChild: jest.fn() } as never,
    });

    host.openNote?.('target');

    expect(app.workspace.openLinkText).toHaveBeenCalledWith('target', 'Notes/embed.md', false);
  });

  it('summarizes a note without frontmatter or headings and dedupes its tags', async () => {
    const app = createApp();
    const host = createVaultUiRenderHost(app as unknown as App, {
      sourcePath: 'Notes/embed.md',
      component: { addChild: jest.fn() } as never,
    });

    const summary = await host.describeNote?.('target');

    expect(summary).toEqual({
      title: 'target',
      path: 'resolved/target',
      excerpt: 'First line',
      tags: ['#x', '#y'],
    });
  });

  it('returns null when the described note does not exist', async () => {
    const app = createApp();
    const host = createVaultUiRenderHost(app as unknown as App, {
      sourcePath: '',
      component: { addChild: jest.fn() } as never,
    });

    await expect(host.describeNote?.('missing')).resolves.toBeNull();
  });

  it('resolves vault-relative resources and rejects anything else', () => {
    const app = createApp();
    const host = createVaultUiRenderHost(app as unknown as App, {
      sourcePath: 'Notes/embed.md',
      component: { addChild: jest.fn() } as never,
    });

    expect(host.resolveResource?.('Images/pic.png')).toBe('app://resolved/Images/pic.png');
    expect(host.resolveResource?.('../secret.png')).toBeNull();
    expect(host.resolveResource?.('/abs/pic.png')).toBeNull();
    expect(host.resolveResource?.('\\\\server\\pic.png')).toBeNull();
    expect(host.resolveResource?.('https://example.com/pic.png')).toBeNull();
    expect(host.resolveResource?.('   ')).toBeNull();
  });

  it('opens the search view for a tag instead of touching the vault', () => {
    const app = createApp();
    const setQuery = jest.fn();
    const leaf = { view: { setQuery } };
    app.workspace.getLeavesOfType.mockImplementation((type: string) => (type === 'search' ? [leaf] : []));
    const host = createVaultUiRenderHost(app as unknown as App, {
      sourcePath: '',
      component: { addChild: jest.fn() } as never,
    });

    host.openTag?.('#topic');

    expect(setQuery).toHaveBeenCalledWith('tag:#topic');
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });

  it('renders markdown through Obsidian with the host component and source path', () => {
    const app = createApp();
    const component = { addChild: jest.fn() } as never;
    const host = createVaultUiRenderHost(app as unknown as App, {
      sourcePath: 'Notes/embed.md',
      component,
    });
    const el = {} as HTMLElement;

    host.renderMarkdown?.(el, '**bold**');

    expect(MarkdownRenderer.render).toHaveBeenCalledWith(app, '**bold**', el, 'Notes/embed.md', component);
  });

  it('lets the caller override markdown rendering', () => {
    const app = createApp();
    const renderMarkdown = jest.fn();
    const host = createVaultUiRenderHost(app as unknown as App, {
      sourcePath: '',
      component: { addChild: jest.fn() } as never,
      renderMarkdown,
    });
    const el = {} as HTMLElement;

    host.renderMarkdown?.(el, 'x');

    expect(renderMarkdown).toHaveBeenCalledWith(el, 'x');
    expect(MarkdownRenderer.render).not.toHaveBeenCalled();
  });
});
