import { createTextLayoutEngine, toCanvasFont } from '@/utils/textLayout/engine';
import type { TextLayoutStyle } from '@/utils/textLayout/types';

const STYLE: TextLayoutStyle = {
  fontFamily: 'Test Sans',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 24,
};

/** 1em per CJK character, 0.5em otherwise: deterministic and font-free. */
function measureWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += char.codePointAt(0)! > 0x2e80 ? fontSize : fontSize * 0.5;
  }
  return width;
}

interface FakeContext {
  font: string;
  measureText: (text: string) => { width: number };
}

function installFakeCanvas(): void {
  const context: FakeContext = {
    font: '',
    measureText(text: string) {
      const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(context.font)?.[1] ?? '16');
      return { width: measureWidth(text, size) };
    },
  };
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
    getContext(): FakeContext {
      return context;
    }
  };
}

function removeFakeCanvas(): void {
  delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
}

describe('createTextLayoutEngine without a canvas', () => {
  it('predicts nothing so callers fall back', () => {
    removeFakeCanvas();
    const engine = createTextLayoutEngine();
    expect(engine.predict('hello world', STYLE, 400)).toBeNull();
  });
});

describe('createTextLayoutEngine', () => {
  beforeEach(() => {
    installFakeCanvas();
  });

  afterEach(() => {
    removeFakeCanvas();
  });

  it('counts one line for text that fits', () => {
    const engine = createTextLayoutEngine();
    const result = engine.predict('hello', STYLE, 400);
    expect(result).toEqual({ lineCount: 1, height: 24 });
  });

  it('counts the lines a narrower column produces', () => {
    const engine = createTextLayoutEngine();
    // 10 chars x 8px = 80px of text: two lines at 40px, four lines at 20px.
    const narrow = engine.predict('abcdefghij', STYLE, 40);
    const narrower = engine.predict('abcdefghij', STYLE, 20);
    expect(narrow?.lineCount).toBe(2);
    expect(narrower?.lineCount).toBe(5);
    expect(narrow?.height).toBe(48);
  });

  it('breaks CJK text between characters', () => {
    const engine = createTextLayoutEngine();
    const result = engine.predict('一二三四五六', STYLE, 48);
    expect(result?.lineCount).toBe(2);
  });

  it('returns zero lines for empty text', () => {
    const engine = createTextLayoutEngine();
    expect(engine.predict('', STYLE, 400)).toEqual({ lineCount: 0, height: 0 });
  });

  it('caches predictions per font, width, and text', () => {
    const engine = createTextLayoutEngine();
    const first = engine.predict('hello world', STYLE, 400);
    const second = engine.predict('hello world', STYLE, 400);
    expect(second).toBe(first);
    expect(engine.predict('hello world', STYLE, 200)).not.toBe(first);
  });

  it('treats sub-pixel width jitter as the same input', () => {
    const engine = createTextLayoutEngine();
    const first = engine.predict('hello world', STYLE, 400);
    expect(engine.predict('hello world', STYLE, 400.1)).toBe(first);
  });

  it('ignores unusable styles and widths', () => {
    const engine = createTextLayoutEngine();
    expect(engine.predict('hello', { ...STYLE, fontSize: 0 }, 400)).toBeNull();
    expect(engine.predict('hello', { ...STYLE, lineHeight: 0 }, 400)).toBeNull();
    expect(engine.predict('hello', { ...STYLE, fontFamily: '' }, 400)).toBeNull();
    expect(engine.predict('hello', STYLE, 0)).toBeNull();
    expect(engine.predict('hello', STYLE, Number.NaN)).toBeNull();
  });

  it('resets after clear()', () => {
    const engine = createTextLayoutEngine();
    const first = engine.predict('hello world', STYLE, 400);
    engine.clear();
    const second = engine.predict('hello world', STYLE, 400);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

describe('toCanvasFont', () => {
  it('produces the CSS shorthand canvas needs', () => {
    expect(toCanvasFont(STYLE)).toBe('400 16px Test Sans');
    expect(toCanvasFont({ ...STYLE, fontWeight: 0 })).toBe('400 16px Test Sans');
  });
});
