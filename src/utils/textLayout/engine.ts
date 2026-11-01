/**
 * Off-DOM text layout: predicts line counts and heights without reading the
 * document, so callers can tell "did this grow" and reserve space for content
 * they have not built yet.
 *
 * Backed by a vendored copy of Pretext (see `NOTICE.md`), which replaces
 * DOM-based measurement (`getBoundingClientRect`, `offsetHeight`, forced
 * reflow) with canvas `measureText` plus cached segment widths.
 *
 * Scope is deliberate: the engine itself never touches the document or any
 * global observer. Callers pass an element's font facts and content width, and
 * only Claudian's own surfaces are measured.
 */

import { clearFontMetricsCache } from './fontMetrics';
import type { TextLayoutEngine, TextLayoutResult, TextLayoutStyle } from './types';
import { clearVendorCaches, layoutText, prepareTextForLayout } from './vendorBridge';

/** Predictions are small and repeated per delta; a bounded map is enough. */
const CACHE_LIMIT = 512;

/** Sub-pixel width jitter would otherwise miss the cache on every frame. */
const WIDTH_PRECISION = 2;

/** Builds the CSS font shorthand canvas needs; a bare family name is invalid. */
export function toCanvasFont(style: TextLayoutStyle): string {
  const weight = style.fontWeight > 0 ? style.fontWeight : 400;
  return `${String(weight)} ${String(style.fontSize)}px ${style.fontFamily}`;
}

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizeWidth(maxWidth: number): number {
  return Math.round(maxWidth * WIDTH_PRECISION) / WIDTH_PRECISION;
}

function isUsablePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function storePrediction(
  cache: Map<string, TextLayoutResult>,
  key: string,
  result: TextLayoutResult,
): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, result);
}

export function createTextLayoutEngine(): TextLayoutEngine {
  const cache = new Map<string, TextLayoutResult>();
  /** Set once measuring proves impossible in this renderer (no canvas). */
  let unavailable = false;

  return {
    predict(text: string, style: TextLayoutStyle, maxWidth: number): TextLayoutResult | null {
      if (unavailable) return null;
      if (typeof text !== 'string') return null;
      if (text.length === 0) return { lineCount: 0, height: 0 };
      if (!isUsablePositive(maxWidth) || !isUsablePositive(style.fontSize)) return null;
      if (!isUsablePositive(style.lineHeight) || style.fontFamily.length === 0) return null;

      const width = normalizeWidth(maxWidth);
      const canvasFont = toCanvasFont(style);
      const key = `${canvasFont}|${String(width)}|${String(style.lineHeight)}|${String(text.length)}|${fingerprint(text)}`;

      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const prepared = prepareTextForLayout(text, canvasFont);
      if (prepared === null) {
        // Repeated failures mean this renderer cannot measure at all.
        unavailable = true;
        return null;
      }

      const laidOut = layoutText(prepared, width, style.lineHeight);
      if (laidOut === null) return null;

      storePrediction(cache, key, laidOut);
      return laidOut;
    },

    clear(): void {
      cache.clear();
      unavailable = false;
      clearFontMetricsCache();
      clearVendorCaches();
    },
  };
}
