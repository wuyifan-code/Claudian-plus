/**
 * Resolves the CSS font facts the layout engine needs from a rendered element.
 *
 * `getComputedStyle` is cheap but not free, and the streaming path would call
 * it per delta, so results are cached per element behind a signature that also
 * covers theme and inline-style changes.
 */

import type { TextLayoutStyle } from './types';

interface CachedStyle {
  signature: string;
  value: TextLayoutStyle;
}

/** CSS `normal` line height, used when the declaration resolves to no length. */
const NORMAL_LINE_HEIGHT_RATIO = 1.2;

let styleCache = new WeakMap<HTMLElement, CachedStyle>();

export function clearFontMetricsCache(): void {
  styleCache = new WeakMap<HTMLElement, CachedStyle>();
}

/**
 * Anything that can change the effective font without touching this element:
 * its own class/style and the document-level theme classes.
 */
function styleSignature(el: HTMLElement): string {
  const themeClasses = el.ownerDocument?.body?.className ?? '';
  return `${el.className}\u0000${el.getAttribute('style') ?? ''}\u0000${themeClasses}`;
}

function parseFontWeight(raw: string): number {
  const numeric = Number.parseInt(raw, 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return raw === 'bold' ? 700 : 400;
}

function parseLineHeight(raw: string, fontSize: number): number {
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fontSize * NORMAL_LINE_HEIGHT_RATIO;
  }
  if (raw.endsWith('px')) return numeric;
  if (raw.endsWith('%')) return (numeric / 100) * fontSize;
  // Unitless multipliers are relative to the font size.
  return numeric * fontSize;
}

/** First family of the stack, unquoted, or empty when the stack is unusable. */
function parseFontFamily(raw: string): string {
  const first = raw.replace(/["']/g, '').split(',')[0];
  return first === undefined ? '' : first.trim();
}

/** Returns `null` when the element has no usable font (detached, no window). */
export function resolveTextStyle(el: HTMLElement | null | undefined): TextLayoutStyle | null {
  if (el === null || el === undefined) return null;
  const view = el.ownerDocument?.defaultView;
  if (view === null || view === undefined || typeof view.getComputedStyle !== 'function') {
    return null;
  }

  const signature = styleSignature(el);
  const cached = styleCache.get(el);
  if (cached !== undefined && cached.signature === signature) return cached.value;

  let computed: CSSStyleDeclaration;
  try {
    computed = view.getComputedStyle(el);
  } catch {
    return null;
  }

  const fontFamily = parseFontFamily(computed.fontFamily ?? '');
  const fontSize = Number.parseFloat(computed.fontSize ?? '');
  if (fontFamily.length === 0 || !Number.isFinite(fontSize) || fontSize <= 0) return null;

  const value: TextLayoutStyle = {
    fontFamily,
    fontSize,
    fontWeight: parseFontWeight(computed.fontWeight ?? ''),
    lineHeight: parseLineHeight(computed.lineHeight ?? '', fontSize),
  };
  if (!(value.lineHeight > 0)) return null;

  styleCache.set(el, { signature, value });
  return value;
}
