import {
  buildPreviewText,
  buildTurnNavigatorItems,
  resolveActiveItemIndex,
  resolveBarVisualState,
} from '@/features/chat/ui/turnNavigator/model';

const previewOptions = {
  assistantEmptyPreview: 'No reply',
  assistantRunningPreview: 'Working...',
  userFallbackPreview: 'Untitled',
  maxPreviewChars: 60,
  maxPreviewParagraphs: 2,
};

describe('buildPreviewText', () => {
  it('collapses runs of whitespace into single spaces', () => {
    expect(buildPreviewText(['  hello   world \n again '], 'fallback')).toBe('hello world again');
  });

  it('keeps one blank line as a paragraph break', () => {
    expect(buildPreviewText(['first\n\nsecond'], 'fallback')).toBe('first\nsecond');
  });

  it('stops after the paragraph limit', () => {
    expect(buildPreviewText(['one\n\ntwo\n\nthree'], 'fallback', 220, 2)).toBe('one\ntwo');
  });

  it('truncates with an ellipsis past the character budget', () => {
    const result = buildPreviewText(['abcdefghijklmnop'], 'fallback', 10, 2);
    expect(result).toBe('abcdefg...');
  });

  it('falls back when nothing is left', () => {
    expect(buildPreviewText(['   \n  '], 'Untitled')).toBe('Untitled');
  });
});

describe('buildTurnNavigatorItems', () => {
  it('builds one entry per query with the assistant text preview', () => {
    const items = buildTurnNavigatorItems(
      [{ key: 'm1', userText: 'How do I bisect?', assistantText: 'Use git bisect.', isRunning: false }],
      previewOptions,
    );

    expect(items).toEqual([
      {
        key: 'm1',
        userPreview: 'How do I bisect?',
        assistantPreview: 'Use git bisect.',
        assistantPreviewKind: 'text',
      },
    ]);
  });

  it('marks a query whose reply is still streaming', () => {
    const items = buildTurnNavigatorItems(
      [{ key: 'm2', userText: 'Explain the diff', assistantText: '', isRunning: true }],
      previewOptions,
    );

    expect(items[0].assistantPreviewKind).toBe('running');
    expect(items[0].assistantPreview).toBe('Working...');
  });

  it('marks a finished query without assistant text as empty', () => {
    const items = buildTurnNavigatorItems(
      [{ key: 'm3', userText: 'Ping', assistantText: '  ', isRunning: false }],
      previewOptions,
    );

    expect(items[0].assistantPreviewKind).toBe('empty');
    expect(items[0].assistantPreview).toBe('No reply');
  });

  it('falls back to placeholder copy for an empty query', () => {
    const items = buildTurnNavigatorItems(
      [{ key: 'm4', userText: '   ', assistantText: 'ok', isRunning: false }],
      previewOptions,
    );

    expect(items[0].userPreview).toBe('Untitled');
  });
});

describe('resolveActiveItemIndex', () => {
  const positions = [
    { start: 0, end: 100 },
    { start: 100, end: 300 },
    { start: 300, end: 400 },
  ];

  it('returns undefined for an empty list', () => {
    expect(resolveActiveItemIndex([], 0, 100)).toBeUndefined();
  });

  it('picks the row that contains the viewport start', () => {
    expect(resolveActiveItemIndex(positions, 150, 100)).toBe(1);
  });

  it('prefers the row closest to the viewport top when several intersect', () => {
    expect(resolveActiveItemIndex(positions, 290, 400)).toBe(2);
  });

  it('falls back to the last row that started above the viewport', () => {
    expect(resolveActiveItemIndex(positions, 900, 100)).toBe(2);
  });

  it('starts at the first row for a negative offset', () => {
    expect(resolveActiveItemIndex(positions, -20, 100)).toBe(0);
  });
});

describe('resolveBarVisualState', () => {
  it('renders every bar idle without a focus', () => {
    expect(resolveBarVisualState(0, undefined)).toEqual({
      colorTone: 'muted',
      opacity: 0.58,
      scaleX: 1,
      tone: 'idle',
    });
  });

  it('peaks at the focused bar and decays over two neighbours', () => {
    expect(resolveBarVisualState(4, 4)).toMatchObject({ scaleX: 2.6, opacity: 1, tone: 'peak' });
    expect(resolveBarVisualState(5, 4)).toMatchObject({ scaleX: 1.7, opacity: 0.86, tone: 'near' });
    expect(resolveBarVisualState(6, 4)).toMatchObject({ scaleX: 1.25, opacity: 0.72, tone: 'mid' });
    expect(resolveBarVisualState(7, 4)).toMatchObject({ scaleX: 1, opacity: 0.58, tone: 'idle' });
  });

  it('uses the focus colour only at the peak', () => {
    expect(resolveBarVisualState(2, 2).colorTone).toBe('focus');
    expect(resolveBarVisualState(3, 2).colorTone).toBe('muted');
  });
});
