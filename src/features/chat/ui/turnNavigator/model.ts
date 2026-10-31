/**
 * Pure model for the conversation turn navigator, ported from ZCode's
 * conversationTurnNavigatorHelpers. The host keeps the DOM extraction in the
 * component so this module stays testable without a document.
 */

export type TurnNavigatorAssistantPreviewKind = 'text' | 'running' | 'empty';

export interface TurnNavigatorQueryInput {
  /** Stable identity for the user message this entry navigates to. */
  key: string;
  userText: string;
  /** First assistant reply that follows the query, if any. */
  assistantText: string;
  isRunning: boolean;
}

export interface TurnNavigatorItem {
  key: string;
  userPreview: string;
  assistantPreview: string;
  assistantPreviewKind: TurnNavigatorAssistantPreviewKind;
}

export interface TurnNavigatorPreviewOptions {
  assistantEmptyPreview: string;
  assistantRunningPreview: string;
  userFallbackPreview: string;
  maxPreviewChars?: number;
  maxPreviewParagraphs?: number;
}

export type TurnNavigatorBarTone = 'idle' | 'mid' | 'near' | 'peak';
export type TurnNavigatorBarColorTone = 'focus' | 'muted';

export interface TurnNavigatorBarVisualState {
  colorTone: TurnNavigatorBarColorTone;
  opacity: number;
  scaleX: number;
  tone: TurnNavigatorBarTone;
}

export interface TurnNavigatorPosition {
  start: number;
  end: number;
}

const DEFAULT_MAX_PREVIEW_CHARS = 220;
const DEFAULT_MAX_PREVIEW_PARAGRAPHS = 2;

function truncatePreview(text: string, maxChars: number): string {
  const limit = Math.max(8, maxChars);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

/**
 * Collapses whitespace and paragraph breaks while scanning, so a streaming
 * reply never re-scans the whole body just to produce a 220-char preview.
 */
export function buildPreviewText(
  texts: readonly string[],
  fallback: string,
  maxChars = DEFAULT_MAX_PREVIEW_CHARS,
  maxParagraphs = DEFAULT_MAX_PREVIEW_PARAGRAPHS,
): string {
  const charLimit = Math.max(8, maxChars);
  const paragraphLimit = Math.trunc(Math.max(1, maxParagraphs));
  let preview = '';
  let paragraphs = 1;
  let whitespace = false;
  let newlines = 0;

  for (const text of texts) {
    if (preview) {
      whitespace = true;
      newlines = 2;
    }
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (/\s/u.test(character)) {
        whitespace = true;
        if (character === '\n') {
          newlines += 1;
        }
        continue;
      }
      if (whitespace && preview) {
        if (newlines >= 2) {
          if (paragraphs >= paragraphLimit) {
            return truncatePreview(preview, charLimit);
          }
          paragraphs += 1;
          preview += '\n';
        } else {
          preview += ' ';
        }
      }
      preview += character;
      whitespace = false;
      newlines = 0;
      if (preview.length > charLimit) {
        return truncatePreview(preview, charLimit);
      }
    }
  }

  return preview || fallback;
}

/** One navigator entry per user query; the assistant preview describes its reply. */
export function buildTurnNavigatorItems(
  queries: readonly TurnNavigatorQueryInput[],
  options: TurnNavigatorPreviewOptions,
): TurnNavigatorItem[] {
  return queries.map((query) => {
    const userPreview = buildPreviewText(
      [query.userText],
      options.userFallbackPreview,
      options.maxPreviewChars,
      options.maxPreviewParagraphs,
    );

    if (query.assistantText.trim().length > 0) {
      return {
        key: query.key,
        userPreview,
        assistantPreview: buildPreviewText(
          [query.assistantText],
          options.assistantEmptyPreview,
          options.maxPreviewChars,
          options.maxPreviewParagraphs,
        ),
        assistantPreviewKind: 'text',
      };
    }

    return {
      key: query.key,
      userPreview,
      assistantPreview: query.isRunning
        ? options.assistantRunningPreview
        : options.assistantEmptyPreview,
      assistantPreviewKind: query.isRunning ? 'running' : 'empty',
    };
  });
}

function resolveFiniteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Index of the entry nearest the viewport start, restricted to rows that
 * intersect the viewport. Falls back to the closest preceding row.
 */
export function resolveActiveItemIndex(
  positions: readonly TurnNavigatorPosition[],
  scrollOffsetPx: number,
  viewportHeightPx: number,
): number | undefined {
  if (positions.length === 0) {
    return undefined;
  }

  const viewportStart = resolveFiniteNonNegative(scrollOffsetPx);
  const viewportEnd = viewportStart + Math.max(1, resolveFiniteNonNegative(viewportHeightPx));

  let active: number | undefined;
  let distance = Number.POSITIVE_INFINITY;
  let before: number | undefined;

  positions.forEach((position, index) => {
    const start = resolveFiniteNonNegative(position.start);
    const end = Math.max(start, resolveFiniteNonNegative(position.end));

    if (end >= viewportStart && start <= viewportEnd) {
      const delta = Math.abs(start - viewportStart);
      if (delta < distance) {
        active = index;
        distance = delta;
      }
    }
    if (start <= viewportStart) {
      before = index;
    }
  });

  return active ?? before ?? 0;
}

/** Hover mountain: peak at the pointer, decaying for the two neighbours. */
export function resolveBarVisualState(
  itemIndex: number,
  visualFocusItemIndex: number | undefined,
): TurnNavigatorBarVisualState {
  if (visualFocusItemIndex === undefined) {
    return { colorTone: 'muted', opacity: 0.58, scaleX: 1, tone: 'idle' };
  }

  const distance = Math.abs(itemIndex - visualFocusItemIndex);
  if (distance === 0) {
    return { colorTone: 'focus', opacity: 1, scaleX: 2.6, tone: 'peak' };
  }
  if (distance === 1) {
    return { colorTone: 'muted', opacity: 0.86, scaleX: 1.7, tone: 'near' };
  }
  if (distance === 2) {
    return { colorTone: 'muted', opacity: 0.72, scaleX: 1.25, tone: 'mid' };
  }
  return { colorTone: 'muted', opacity: 0.58, scaleX: 1, tone: 'idle' };
}
