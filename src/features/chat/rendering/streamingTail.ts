/**
 * Decides whether an open streaming block can grow by appending text instead of
 * being parsed as Markdown again.
 *
 * `renderStreamingMarkdown` already keeps closed blocks and re-renders only the
 * open tail, but that tail is still handed to `MarkdownRenderer` on every
 * frame: a prose answer that never leaves one paragraph pays a full parse plus
 * post-processing for every delta. For plain prose, appending the delta to the
 * paragraph's text node produces the identical DOM, so the only open question
 * is when that shortcut is provably safe.
 *
 * Every rule here is conservative by design: a false negative costs one
 * Markdown render (today's behaviour), a false positive would show Markdown
 * source as literal text, which is a visible regression.
 */

/**
 * Characters that can open or continue inline Markdown, inline math, a link, an
 * escaped sequence, a character entity, or raw HTML.
 *
 * `-` and `+` are deliberately absent: they are ordinary punctuation inside a
 * paragraph (`a - b`, `C++`). They only carry Markdown meaning at the start of
 * a block, which {@link BLOCK_OPENER} covers.
 */
const INLINE_SYNTAX = /[`*_[\]<>$~|\\&]/;

/**
 * Openers that change the block a tail belongs to. Matched against the start of
 * the whole tail, because a soft line break is already rejected outright: the
 * block rules only matter at the first character.
 */
const BLOCK_OPENER = /^(?:#{1,6}\s|>|[-+]\s|\d+[.)]\s|[-=]{3,}\s*$|:{3,}|\s)/;

function hasInlineSyntax(text: string): boolean {
  return INLINE_SYNTAX.test(text) || text.includes('\n') || text.includes('\r');
}

/**
 * True when `tail` is a single paragraph of plain prose: no inline construct, no
 * line break, no block opener, no leading whitespace (which would start a code
 * block).
 */
export function isPlainTextTail(tail: string): boolean {
  if (tail.length === 0) return true;
  if (hasInlineSyntax(tail)) return false;
  return !BLOCK_OPENER.test(tail);
}

/**
 * True when `delta` can be appended to `tail` as raw text.
 *
 * The delta is judged only on inline syntax: a delta may start with a space or
 * contain `-`, because it is not at the start of a block.
 */
export function canAppendAsText(tail: string, delta: string): boolean {
  if (delta.length === 0) return false;
  if (hasInlineSyntax(delta)) return false;
  return isPlainTextTail(tail);
}
