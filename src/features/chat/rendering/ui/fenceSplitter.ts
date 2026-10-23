/**
 * Splits assistant markdown into plain markdown segments and declarative UI
 * fence segments.
 *
 * The UI payload travels inside a normal ```claudian-ui fence rather than a new
 * stream chunk or a tool call, because provider transcripts only guarantee text:
 * a fenced program survives history replay on every provider without a single
 * protocol change.
 */

export interface MarkdownFenceSegment {
  kind: 'markdown';
  content: string;
}

export interface UiFenceSegment {
  kind: 'ui';
  content: string;
  language: string;
  /** False while streaming, or when the model never closed the fence. */
  closed: boolean;
}

export type UiFencePart = MarkdownFenceSegment | UiFenceSegment;

/** Fence languages treated as declarative UI programs. */
const UI_FENCE_LANGUAGES = new Set(['claudian-ui', 'openui']);

/** Opening fence: up to 3 spaces, ``` or ~~~, then an info string. */
const OPEN_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w.+-]*)/;
/** Closing fence: same character, at least as long, nothing else on the line. */
const CLOSE_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

type FenceMode = 'text' | 'fence' | 'ui';

function isClosingFence(line: string, fenceChar: string, fenceLength: number): boolean {
  const match = CLOSE_FENCE_PATTERN.exec(line);
  if (!match) return false;
  const marker = match[1] ?? '';
  return marker[0] === fenceChar && marker.length >= fenceLength;
}

/**
 * Splits `markdown` on UI fences. Non-UI fences are left untouched inside the
 * markdown segments, so ordinary code blocks keep working.
 *
 * Content is preserved byte-for-byte: the input is only ever cut, never
 * rewritten, which is what lets the existing math/image/link pipeline keep
 * operating on the markdown segments exactly as before.
 */
export function splitUiFences(markdown: string): UiFencePart[] {
  if (!markdown.includes('```') && !markdown.includes('~~~')) {
    return [{ kind: 'markdown', content: markdown }];
  }

  const parts: UiFencePart[] = [];
  const buffer: string[] = [];
  const lines = markdown.split('\n');

  let mode: FenceMode = 'text';
  let fenceChar = '';
  let fenceLength = 0;
  let fenceLanguage = '';
  let uiLines: string[] = [];

  const flushMarkdown = (): void => {
    if (buffer.length === 0) return;
    parts.push({ kind: 'markdown', content: buffer.join('\n') });
    buffer.length = 0;
  };

  const closeUi = (closed: boolean): void => {
    flushMarkdown();
    parts.push({
      kind: 'ui',
      content: uiLines.join('\n'),
      language: fenceLanguage,
      closed,
    });
    uiLines = [];
    mode = 'text';
  };

  for (const line of lines) {
    if (mode === 'fence') {
      buffer.push(line);
      if (isClosingFence(line, fenceChar, fenceLength)) mode = 'text';
      continue;
    }

    if (mode === 'ui') {
      if (isClosingFence(line, fenceChar, fenceLength)) {
        closeUi(true);
        continue;
      }
      uiLines.push(line);
      continue;
    }

    const open = OPEN_FENCE_PATTERN.exec(line);
    if (!open) {
      buffer.push(line);
      continue;
    }

    const marker = open[1] ?? '```';
    const language = (open[2] ?? '').toLowerCase();
    fenceChar = marker[0] ?? '`';
    fenceLength = marker.length;

    if (UI_FENCE_LANGUAGES.has(language)) {
      fenceLanguage = language;
      mode = 'ui';
      continue;
    }

    buffer.push(line);
    mode = 'fence';
  }

  if (mode === 'ui') {
    // Unclosed at end of stream: keep the partial program so the renderer can
    // show what is already parseable instead of waiting for the closing fence.
    closeUi(false);
  } else {
    flushMarkdown();
  }

  if (parts.length === 0) {
    return [{ kind: 'markdown', content: markdown }];
  }

  return parts;
}

/** True when the text contains at least one UI fence. */
export function hasUiFence(markdown: string): boolean {
  for (const part of splitUiFences(markdown)) {
    if (part.kind === 'ui') return true;
  }
  return false;
}

/**
 * Cheap pre-check for the streaming hot path: could this text contain any
 * fence at all? Avoids splitting every frame of plain prose.
 */
export function mayContainUiFence(markdown: string): boolean {
  return markdown.includes('```') || markdown.includes('~~~');
}
