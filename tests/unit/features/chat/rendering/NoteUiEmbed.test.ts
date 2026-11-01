/**
 * @jest-environment jsdom
 */
import type { App, MarkdownPostProcessorContext } from 'obsidian';

import {
  type NoteUiEmbedDeps,
  type NoteUiEmbedHandle,
  type NoteUiEmbedHandler,
  registerNoteUiEmbed,
} from '@/features/chat/rendering/NoteUiEmbed';
import { MAX_UI_EMBED_CHARS } from '@/features/chat/rendering/ui/noteFence';
import {
  pruneDetachedUiBlocks,
  uiBlockSubscriptionCount,
} from '@/features/chat/rendering/UiBlockRenderer';

const PROGRAM = [
  'root = Col([heading, body])',
  'heading = Title("Embedded")',
  'body = Text("Hello note")',
].join('\n');

function createApp() {
  return {
    metadataCache: {
      getFirstLinkpathDest: jest.fn(() => null),
      getFileCache: jest.fn(() => null),
    },
    vault: {
      cachedRead: jest.fn(async () => ''),
      adapter: { getResourcePath: jest.fn((path: string) => 'app://' + path) },
    },
    workspace: {
      openLinkText: jest.fn(),
      getLeavesOfType: jest.fn(() => []),
    },
  };
}

interface Harness {
  handlers: Map<string, NoteUiEmbedHandler>;
  handle: NoteUiEmbedHandle;
  app: ReturnType<typeof createApp>;
}

function createCtx(sourcePath = 'Notes/embed.md') {
  const added: Array<{ unload(): void }> = [];
  const ctx = {
    sourcePath,
    docId: 'doc-1',
    frontmatter: null,
    addChild: jest.fn((child: { unload(): void }) => {
      added.push(child);
      return child;
    }),
    getSectionInfo: jest.fn(() => null),
  };
  return { ctx: ctx as unknown as MarkdownPostProcessorContext, added };
}

function install(overrides: Partial<NoteUiEmbedDeps> = {}): Harness {
  const app = createApp();
  const handlers = new Map<string, NoteUiEmbedHandler>();
  const handle = registerNoteUiEmbed({
    app: app as unknown as App,
    registerCodeBlockProcessor: (language, handler) => {
      handlers.set(language, handler);
    },
    ...overrides,
  });
  return { handlers, handle, app };
}

function mount(
  harness: Harness,
  source: string,
  ctx: MarkdownPostProcessorContext,
): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  harness.handlers.get('claudian-ui')!(source, el, ctx);
  return el;
}

describe('registerNoteUiEmbed', () => {
  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
  });

  it('registers both interface fence languages', () => {
    const harness = install();
    expect([...harness.handlers.keys()]).toEqual(['claudian-ui', 'openui']);
    harness.handle.dispose();
  });

  it('renders a fence as native DOM inside the note token scope', () => {
    const harness = install();
    const el = mount(harness, PROGRAM, createCtx().ctx);

    expect(el.querySelector('.claudian-plus-ui-embed')).not.toBeNull();
    expect(el.querySelector('.claudian-plus-ui-embed .claudian-plus-ui-block')).not.toBeNull();
    expect(el.textContent).toContain('Embedded');
    expect(el.textContent).toContain('Hello note');
    harness.handle.dispose();
  });

  it('falls back to plain source when the program cannot be rendered', () => {
    const harness = install();
    const el = mount(harness, 'this is not a program', createCtx().ctx);

    expect(el.querySelector('.claudian-plus-ui-embed')).toBeNull();
    expect(el.querySelector('pre code')?.textContent).toContain('this is not a program');
    harness.handle.dispose();
  });

  it('falls back for programs above the size guard', () => {
    const harness = install();
    const source = 'root = Text("' + 'x'.repeat(MAX_UI_EMBED_CHARS) + '")';
    const el = mount(harness, source, createCtx().ctx);

    expect(el.querySelector('pre code')).not.toBeNull();
    harness.handle.dispose();
  });

  it('keeps identical fences in one note on separate state scopes', () => {
    const harness = install();
    const first = mount(harness, PROGRAM, createCtx().ctx);
    const second = mount(harness, PROGRAM, createCtx().ctx);

    expect(uiBlockSubscriptionCount()).toBe(2);
    // A shared key would have released the first block when the second mounted.
    expect(first.querySelectorAll('.claudian-plus-ui-toolbar')).toHaveLength(1);
    expect(second.querySelectorAll('.claudian-plus-ui-toolbar')).toHaveLength(1);
    harness.handle.dispose();
    expect(uiBlockSubscriptionCount()).toBe(0);
  });

  it('bridges @ToAssistant to the chat composer', () => {
    const prefillChat = jest.fn();
    const harness = install({ prefillChat });
    const el = mount(harness, 'root = Button("Ask", @ToAssistant("explain"))', createCtx().ctx);

    (el.querySelector('.claudian-plus-ui-button') as HTMLElement).click();

    expect(prefillChat).toHaveBeenCalledWith('explain');
    harness.handle.dispose();
  });

  it('releases the block when Obsidian removes the section', () => {
    const harness = install();
    const { ctx, added } = createCtx();
    mount(harness, PROGRAM, ctx);

    expect(uiBlockSubscriptionCount()).toBe(1);
    added[0]!.unload();
    expect(uiBlockSubscriptionCount()).toBe(0);
    harness.handle.dispose();
  });

  it('disposes every mounted block on unload', () => {
    const harness = install();
    mount(harness, PROGRAM, createCtx().ctx);
    expect(uiBlockSubscriptionCount()).toBe(1);

    harness.handle.dispose();

    expect(uiBlockSubscriptionCount()).toBe(0);
  });
});

describe('registerNoteUiEmbed deferred build', () => {
  const idleCallbacks: Array<() => void> = [];
  const cancelIdle = jest.fn();

  beforeEach(() => {
    idleCallbacks.length = 0;
    cancelIdle.mockClear();
    (window as unknown as {
      requestIdleCallback: (callback: () => void) => number;
      cancelIdleCallback: (handle: number) => void;
    }).requestIdleCallback = (callback: () => void) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    };
    (window as unknown as { cancelIdleCallback: (handle: number) => void }).cancelIdleCallback = cancelIdle;
  });

  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    delete (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback;
  });

  it('reserves space first and builds when idle', () => {
    const harness = install();
    const el = mount(harness, PROGRAM, createCtx().ctx);
    const wrapper = el.querySelector('.claudian-plus-ui-embed') as HTMLElement;

    expect(idleCallbacks).toHaveLength(1);
    expect(wrapper.classList.contains('is-pending')).toBe(true);
    expect(wrapper.style.getPropertyValue('--claudian-plus-ui-embed-reserve')).toMatch(/^\d+px$/);
    // Nothing is built yet: the note paints without the widget tree.
    expect(el.textContent).not.toContain('Hello note');

    idleCallbacks[0]!();

    expect(el.textContent).toContain('Hello note');
    expect(wrapper.classList.contains('is-pending')).toBe(false);
    harness.handle.dispose();
  });

  it('cancels a pending build when the section unloads', () => {
    const harness = install();
    const { ctx, added } = createCtx();
    const el = mount(harness, PROGRAM, ctx);

    added[0]!.unload();
    expect(cancelIdle).toHaveBeenCalled();

    // A stale callback must not build into a released block.
    idleCallbacks[0]!();
    expect(el.textContent).not.toContain('Hello note');
    expect(uiBlockSubscriptionCount()).toBe(0);
    harness.handle.dispose();
  });

  it('builds immediately when the environment cannot defer', () => {
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    const harness = install();
    const el = mount(harness, PROGRAM, createCtx().ctx);

    expect(el.textContent).toContain('Hello note');
    expect(el.querySelector('.claudian-plus-ui-embed')!.classList.contains('is-pending')).toBe(false);
    harness.handle.dispose();
  });
});
