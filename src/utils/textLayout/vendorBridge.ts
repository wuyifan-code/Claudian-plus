/**
 * The single boundary between this plugin and the vendored Pretext code.
 *
 * The vendored files carry `@ts-nocheck`, so their exports are untyped.
 * Concentrating the calls here keeps one typed surface for the rest of the
 * plugin and one place to adapt if a future Pretext version changes its API.
 */

import {
  clearCache as clearLayoutCache,
  layout as layoutPrepared,
  prepare as prepareText,
} from './vendor/layout';

declare const preparedTextBrand: unique symbol;

/** Opaque handle produced by {@link prepareTextForLayout}. */
export type PreparedText = { readonly [preparedTextBrand]: true };

/** Segments and measures `text` once so it can be laid out at any width. */
export function prepareTextForLayout(text: string, canvasFont: string): PreparedText | null {
  try {
    const prepared = prepareText(text, canvasFont, { whiteSpace: 'normal' });
    if (prepared === null || prepared === undefined) return null;
    return prepared as unknown as PreparedText;
  } catch {
    // No canvas in this renderer, or an engine bug: the caller falls back.
    return null;
  }
}

/** Pure arithmetic on the prepared widths: no canvas calls, no DOM reads. */
export function layoutText(
  prepared: PreparedText,
  maxWidth: number,
  lineHeight: number,
): { lineCount: number; height: number } | null {
  try {
    const result = layoutPrepared(prepared, maxWidth, lineHeight);
    const lineCount = result?.lineCount;
    const height = result?.height;
    if (typeof lineCount !== 'number' || typeof height !== 'number') return null;
    return { lineCount, height };
  } catch {
    return null;
  }
}

/** Drops the engine's internal segment and measurement caches. */
export function clearVendorCaches(): void {
  try {
    clearLayoutCache();
  } catch {
    // Clearing is best effort; a stale cache only costs accuracy until reload.
  }
}
