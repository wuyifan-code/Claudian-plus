/**
 * Fence helpers for interfaces embedded in notes.
 *
 * A generated interface travels through a note as a normal fenced program: the
 * markdown source stays readable, editable and diffable, and the note renderer
 * feeds the same bytes to the chat renderer. Keeping the byte-level rules here
 * makes them testable without a document and shared by both directions (chat
 * inserts the fence, a note renders it).
 */

/** Fence languages the note renderer turns back into an interface. */
export const UI_EMBED_LANGUAGES = ['claudian-ui', 'openui'] as const;

/**
 * Programs above this size are shown as plain code: the parser is linear but a
 * pasted megabyte inside live preview would still stall the editor on every
 * keystroke in the surrounding note.
 */
export const MAX_UI_EMBED_CHARS = 200_000;

const BACKTICK_RUN = /`+/g;

/**
 * Builds the fence that carries a program into a note.
 *
 * The marker must be longer than any backtick run inside the program, or the
 * program would close its own fence and swallow the rest of the note.
 */
export function buildUiEmbedFence(program: string): string {
  const body = program.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (body.trim().length === 0) return '';
  const longestRun = (body.match(BACKTICK_RUN) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
  const marker = '`'.repeat(Math.max(3, longestRun + 1));
  return `${marker}${UI_EMBED_LANGUAGES[0]}\n${body}\n${marker}\n`;
}

/**
 * Inserts the fence at the cursor without gluing it to the current line: a
 * fence that starts mid-line is not a block and does not render.
 */
export function buildUiEmbedInsertion(currentLine: string, fence: string): string {
  if (fence.length === 0) return '';
  return currentLine.trim().length === 0 ? fence : `\n\n${fence}`;
}

/** Shared key prefix: note embeds never collide with chat blocks or each other. */
export function noteUiBlockKeyPrefix(sourcePath: string, contentHash: string): string {
  return `note:${sourcePath}:${contentHash}:`;
}

/**
 * State key for one embedded block. `occurrence` distinguishes identical
 * programs in the same note; without it a second block would replace the first
 * block's subscription.
 */
export function noteUiBlockKey(
  sourcePath: string,
  contentHash: string,
  occurrence: number,
): string {
  return `${noteUiBlockKeyPrefix(sourcePath, contentHash)}${String(occurrence)}`;
}
