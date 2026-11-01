import { clearFontMetricsCache, resolveTextStyle } from '@/utils/textLayout/fontMetrics';

interface FakeElement {
  className: string;
  getAttribute: (name: string) => string | null;
  ownerDocument: {
    body: { className: string };
    defaultView: { getComputedStyle: () => Record<string, string> };
  };
}

function createElement(
  computed: Record<string, string>,
  options: { className?: string; bodyClassName?: string } = {},
): FakeElement {
  return {
    className: options.className ?? 'claudian-plus-text-block',
    getAttribute: () => null,
    ownerDocument: {
      body: { className: options.bodyClassName ?? 'theme-dark' },
      defaultView: { getComputedStyle: () => computed },
    },
  };
}

function asElement(el: FakeElement): HTMLElement {
  return el as unknown as HTMLElement;
}

const BASE_COMPUTED = {
  fontFamily: '"Inter", -apple-system, sans-serif',
  fontSize: '16px',
  fontWeight: '600',
  lineHeight: '24px',
};

describe('resolveTextStyle', () => {
  beforeEach(() => {
    clearFontMetricsCache();
  });

  it('normalises computed style into px metrics', () => {
    const style = resolveTextStyle(asElement(createElement(BASE_COMPUTED)));
    expect(style).toEqual({
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 600,
      lineHeight: 24,
    });
  });

  it('resolves unitless and percentage line heights against the font size', () => {
    expect(resolveTextStyle(asElement(createElement({
      ...BASE_COMPUTED,
      lineHeight: '1.5',
    })))?.lineHeight).toBe(24);

    expect(resolveTextStyle(asElement(createElement({
      ...BASE_COMPUTED,
      lineHeight: '150%',
    })))?.lineHeight).toBe(24);
  });

  it('falls back to a normal line height when CSS reports none', () => {
    expect(resolveTextStyle(asElement(createElement({
      ...BASE_COMPUTED,
      lineHeight: 'normal',
    })))?.lineHeight).toBeCloseTo(19.2);
  });

  it('maps the bold keyword to a numeric weight', () => {
    expect(resolveTextStyle(asElement(createElement({
      ...BASE_COMPUTED,
      fontWeight: 'bold',
    })))?.fontWeight).toBe(700);
  });

  it('returns null when there is no element, window, or font', () => {
    expect(resolveTextStyle(null)).toBeNull();
    expect(resolveTextStyle(undefined)).toBeNull();

    const detached = {
      className: '',
      getAttribute: () => null,
      ownerDocument: { body: { className: '' }, defaultView: undefined },
    };
    expect(resolveTextStyle(detached as unknown as HTMLElement)).toBeNull();

    const noFamily = createElement({ ...BASE_COMPUTED, fontFamily: '' });
    expect(resolveTextStyle(asElement(noFamily))).toBeNull();
  });

  it('caches per element until its signature changes', () => {
    const computed = jest.fn(() => BASE_COMPUTED);
    const el = createElement(BASE_COMPUTED);
    el.ownerDocument.defaultView.getComputedStyle = computed;

    resolveTextStyle(asElement(el));
    resolveTextStyle(asElement(el));
    expect(computed).toHaveBeenCalledTimes(1);

    // A theme swap changes the document body class without touching the element.
    el.ownerDocument.body.className = 'theme-light';
    resolveTextStyle(asElement(el));
    expect(computed).toHaveBeenCalledTimes(2);
  });
});
