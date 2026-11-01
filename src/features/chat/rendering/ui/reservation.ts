/**
 * Space reservation for interfaces embedded in notes.
 *
 * An embedded program is parsed and built into DOM, which is expensive enough
 * that a note with many embeds blocks its own first paint. The embed therefore
 * builds later, and the space it will occupy is reserved up front so the note's
 * layout does not jump when the real block appears.
 *
 * The reserve is a prediction, never a measurement: it comes from the text a
 * program declares, laid out off-DOM at the note's width, plus the block's own
 * padding and toolbar. Deliberately pure so it can be tested without a document.
 */

import type { UiExpr, UiProgram } from './parser';

/** Padding plus the block toolbar row that no text accounts for. */
const EMBED_CHROME_PX = 56;

/** A collapsed reserve is worse than a small one: keep a usable minimum. */
const EMBED_MIN_PX = 72;

/** A program cannot reserve more than this; beyond it the note is unstable anyway. */
const EMBED_MAX_PX = 1600;

function collectFromExpr(expr: UiExpr | null, out: string[]): void {
  if (expr === null) return;
  switch (expr.kind) {
    case 'literal':
      if (typeof expr.value === 'string') out.push(expr.value);
      return;
    case 'array':
      for (const item of expr.items) collectFromExpr(item, out);
      return;
    case 'object':
      for (const entry of expr.entries) collectFromExpr(entry.value, out);
      return;
    case 'call':
      for (const arg of expr.args) collectFromExpr(arg, out);
      return;
    case 'member':
      collectFromExpr(expr.target, out);
      return;
    case 'index':
      collectFromExpr(expr.target, out);
      collectFromExpr(expr.index, out);
      return;
    case 'reference':
    case 'state':
      return;
  }
}

/**
 * Every human-readable string a program declares, joined for layout prediction.
 * Structurally identical to what the widgets will render as text, minus the
 * widget chrome each of them adds.
 */
export function collectUiProgramText(program: UiProgram): string {
  const collected: string[] = [];
  for (const statement of program.statements.values()) {
    collectFromExpr(statement.expr, collected);
  }
  return collected.join(' ');
}

/**
 * Converts a predicted text height into the space an embed should hold until it
 * is built. Returns the minimum when prediction was unavailable.
 */
export function reserveEmbedHeight(predictedTextHeight: number | null): number {
  if (predictedTextHeight === null || !Number.isFinite(predictedTextHeight) || predictedTextHeight <= 0) {
    return EMBED_MIN_PX;
  }
  const total = Math.round(predictedTextHeight + EMBED_CHROME_PX);
  return Math.min(EMBED_MAX_PX, Math.max(EMBED_MIN_PX, total));
}
