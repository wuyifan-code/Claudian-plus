import { createMockEl } from '@test/helpers/mockElement';
import { MarkdownRenderer } from 'obsidian';

import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';

/**
 * Streaming render path.
 *
 * The renderer keeps closed blocks and only re-renders the open tail; these
 * tests pin down when the tail may be extended by appending text instead of
 * being re-parsed as Markdown, and when the renderer reports that the block
 * changed height.
 */

const COMPUTED_STYLE = {
  fontFamily: 'Test Sans',
  fontSize: '16px',
  fontWeight: '400',
  lineHeight: '24px',
};

/** 1em per CJK character, 0.5em otherwise: deterministic and font-free. */
function installFakeCanvas(): void {
  const context = {
    font: '',
    measureText(text: string) {
      const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(context.font)?.[1] ?? '16');
      let width = 0;
      for (const char of text) {
        width += char.codePointAt(0)! > 0x2e80 ? size : size * 0.5;
      }
      return { width };
    },
  };
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
    getContext(): typeof context {
      return context;
    }
  };
}

function removeFakeCanvas(): void {
  delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
}

/**
 * Stands in for Obsidian's renderer: one paragraph per rendered chunk. The
 * streaming commit path moves children out of a scratch chunk, which the mock
 * element cannot do, so scratch chunks render nothing.
 */
function installParagraphRenderer(): jest.Mock {
  const render = MarkdownRenderer.render as jest.Mock;
  render.mockImplementation(async (_app: unknown, markdown: string, el: any) => {
    if (el.hasClass?.('claudian-plus-stream-chunk')) return;
    const paragraph = el.createEl('p');
    paragraph.textContent = markdown;
  });
  return render;
}

function createRenderer(settings: Record<string, unknown> = {}) {
  const messagesEl = createMockEl();
  const plugin = { app: {}, settings: { mediaFolder: '', ...settings } };
  const component = {
    registerDomEvent: jest.fn(),
    register: jest.fn(),
    addChild: jest.fn(),
  };
  const renderer = new MessageRenderer(plugin as any, component as any, messagesEl);
  return { renderer, messagesEl };
}

/** Gives the layout engine everything it needs to predict this element. */
function makeMeasurable(el: any, width = 160): void {
  el.clientWidth = width;
  el.ownerDocument.defaultView.getComputedStyle = () => COMPUTED_STYLE;
}

function tailTextOf(el: any): string {
  const tail = el.children.find((child: any) => child.hasClass?.('claudian-plus-stream-tail'));
  return tail?.children.map((child: any) => child.textContent).join('') ?? '';
}

async function stream(renderer: MessageRenderer, el: any, deltas: string[]): Promise<string> {
  let accumulated = '';
  for (const delta of deltas) {
    accumulated += delta;
    await renderer.renderContent(el, accumulated, { streaming: true });
  }
  return accumulated;
}

describe('MessageRenderer streaming tail', () => {
  let render: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    render = installParagraphRenderer();
    installFakeCanvas();
  });

  afterEach(() => {
    removeFakeCanvas();
  });

  it('appends plain deltas without re-parsing the tail', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    makeMeasurable(el, 400);

    const deltas = Array.from({ length: 200 }, (_, index) => `word${String(index)} `);
    const full = await stream(renderer, el, deltas);

    expect(render).toHaveBeenCalledTimes(1);
    expect(tailTextOf(el).trimEnd()).toBe(full.trimEnd());
  });

  it('appends plain CJK deltas the same way', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    makeMeasurable(el, 400);

    const full = await stream(renderer, el, ['这是一段', '流式输出', '的中文内容。']);

    expect(render).toHaveBeenCalledTimes(1);
    expect(tailTextOf(el)).toBe(full);
  });

  it('falls back to Markdown once the tail stops being plain prose', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    makeMeasurable(el, 400);

    await stream(renderer, el, ['Some ', 'prose ']);
    expect(render).toHaveBeenCalledTimes(1);

    await renderer.renderContent(el, 'Some prose **bo', { streaming: true });
    await renderer.renderContent(el, 'Some prose **bold**', { streaming: true });

    // One render for the construct, one for every frame after it: the fast path
    // stays off for the rest of the block.
    expect(render).toHaveBeenCalledTimes(3);
    expect(render.mock.calls[2][1]).toBe('Some prose **bold**');
  });

  it('re-renders every frame when the fast path is disabled', async () => {
    const { renderer } = createRenderer({ streamingPlainTextFastPath: false });
    const el = createMockEl();
    makeMeasurable(el, 400);

    await stream(renderer, el, ['Hello', ' there', ' friend']);

    expect(render).toHaveBeenCalledTimes(3);
    expect(render.mock.calls[2][1]).toBe('Hello there friend');
  });

  it('does not append when the renderer normalised the paragraph text', async () => {
    // A renderer that trims trailing whitespace would make appends lose a space,
    // so the fast path must verify the paragraph's text before trusting it.
    render.mockImplementation(async (_app: unknown, markdown: string, el: any) => {
      if (el.hasClass?.('claudian-plus-stream-chunk')) return;
      const paragraph = el.createEl('p');
      paragraph.textContent = markdown.trim();
    });

    const { renderer } = createRenderer();
    const el = createMockEl();
    makeMeasurable(el, 400);

    await stream(renderer, el, ['Hello ', 'world']);

    expect(render).toHaveBeenCalledTimes(2);
    expect(tailTextOf(el)).toBe('Hello world');
  });

  it('reports a visual change only when the predicted line count moves', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    // 8px per character: 20 characters per 160px line.
    makeMeasurable(el, 160);

    await renderer.renderContent(el, 'a'.repeat(10), { streaming: true });
    expect(renderer.consumeStreamingVisualChange(el)).toBe(true);

    await renderer.renderContent(el, 'a'.repeat(15), { streaming: true });
    expect(renderer.consumeStreamingVisualChange(el)).toBe(false);

    await renderer.renderContent(el, 'a'.repeat(25), { streaming: true });
    expect(renderer.consumeStreamingVisualChange(el)).toBe(true);
  });

  it('reports a visual change when prediction is unavailable', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    // No measurable width, so the engine cannot predict: callers must scroll.
    await renderer.renderContent(el, 'hello', { streaming: true });
    expect(renderer.consumeStreamingVisualChange(el)).toBe(true);
    await renderer.renderContent(el, 'hello there', { streaming: true });
    expect(renderer.consumeStreamingVisualChange(el)).toBe(true);
  });

  it('treats an unknown element as changed', () => {
    const { renderer } = createRenderer();
    expect(renderer.consumeStreamingVisualChange(createMockEl())).toBe(true);
  });

  it('resets the tail when a block boundary commits', async () => {
    // The commit path builds a scratch chunk with Obsidian's global `createDiv`,
    // which this environment resolves through a real `document`.
    const globals = globalThis as { document?: unknown; createDiv?: unknown };
    const previousDocument = globals.document;
    const previousCreateDiv = globals.createDiv;
    globals.document = { createElement: () => createMockEl() };
    globals.createDiv = (info?: { cls?: string }) => {
      const created = createMockEl();
      if (info?.cls) created.addClass(info.cls);
      return created;
    };

    try {
      const { renderer } = createRenderer();
      const el = createMockEl();
      makeMeasurable(el, 400);

      await renderer.renderContent(el, 'first block\n\n', { streaming: true });
      expect(renderer.consumeStreamingVisualChange(el)).toBe(true);
      expect(tailTextOf(el)).toBe('');

      await renderer.renderContent(el, 'first block\n\nsecond', { streaming: true });
      expect(renderer.consumeStreamingVisualChange(el)).toBe(true);
      expect(tailTextOf(el)).toBe('second');
    } finally {
      globals.document = previousDocument;
      globals.createDiv = previousCreateDiv;
    }
  });
});
