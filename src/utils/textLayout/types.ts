/**
 * Contract for off-DOM text layout.
 *
 * The engine answers "how many lines does this text take, and how tall is that"
 * without touching the document, so renderers can decide whether content grew
 * and reserve space for content they have not built yet. Every caller must
 * accept `null`: prediction is an optimisation, never a correctness
 * dependency.
 */

/** Resolved CSS font facts for one element, normalised to pixels. */
export interface TextLayoutStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** Line height in pixels. */
  lineHeight: number;
}

export interface TextLayoutResult {
  lineCount: number;
  /** `lineCount * lineHeight` in pixels. */
  height: number;
}

export interface TextLayoutEngine {
  /**
   * Predicts the layout of `text` when it wraps at `maxWidth`.
   *
   * Returns `null` when the engine cannot measure (no canvas in this renderer,
   * unusable style, non-positive width) or when the text cannot be prepared.
   */
  predict(text: string, style: TextLayoutStyle, maxWidth: number): TextLayoutResult | null;
  /** Drops every cache, including the font-metric cache. */
  clear(): void;
}
