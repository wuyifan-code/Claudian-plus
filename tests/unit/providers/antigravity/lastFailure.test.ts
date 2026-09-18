import {
  ANTIGRAVITY_FAILURE_CATEGORIES,
  ANTIGRAVITY_FAILURE_DETAIL_MAX_LENGTH,
  createAntigravityLastFailure,
  isAntigravityFailureCategory,
  normalizeAntigravityLastFailure,
} from '@/providers/antigravity/lastFailure';

const PRIVATE_PATH = 'C:\\Users\\ada\\AppData\\Local\\agy\\bin\\agy.EXE';
const EMAIL = 'ada@example.com';
const TOKEN = 'sk-live-0123456789abcdefghij';
const PROMPT_BODY = [
  'You are a helpful assistant working inside a vault.',
  'Always answer in the language the user wrote in.',
  'Current task: summarize the attached note without quoting it.',
].join('\n');

describe('antigravity failure vocabulary', () => {
  it('lists exactly the documented startup failure categories', () => {
    expect([...ANTIGRAVITY_FAILURE_CATEGORIES]).toEqual([
      'cli-missing',
      'spawn-failed',
      'init-failed',
      'timeout',
      'malformed-stream',
    ]);
    for (const category of ANTIGRAVITY_FAILURE_CATEGORIES) {
      expect(isAntigravityFailureCategory(category)).toBe(true);
    }
  });

  it('rejects anything outside that vocabulary', () => {
    expect(isAntigravityFailureCategory('model-error')).toBe(false);
    expect(isAntigravityFailureCategory('timeout ')).toBe(false);
    expect(isAntigravityFailureCategory(undefined)).toBe(false);
    expect(isAntigravityFailureCategory(null)).toBe(false);
    expect(isAntigravityFailureCategory(7)).toBe(false);
    expect(isAntigravityFailureCategory([...ANTIGRAVITY_FAILURE_CATEGORIES])).toBe(false);
  });
});

describe('createAntigravityLastFailure', () => {
  it('records a category, a timestamp, and an optional short detail', () => {
    expect(createAntigravityLastFailure('spawn-failed', {
      detail: 'exit code 1',
      recordedAt: 1_700_000_000_000,
    })).toEqual({
      category: 'spawn-failed',
      recordedAt: 1_700_000_000_000,
      detail: 'exit code 1',
    });

    expect(createAntigravityLastFailure('timeout', { recordedAt: 5 })).toEqual({
      category: 'timeout',
      recordedAt: 5,
    });
  });

  it('rejects an unknown category instead of persisting it', () => {
    expect(() => createAntigravityLastFailure('nope' as never)).toThrow(RangeError);
  });

  it('redacts a detail that carries a path, an email, or a token', () => {
    const failure = createAntigravityLastFailure('spawn-failed', {
      detail: `ENOENT ${PRIVATE_PATH} ${EMAIL} ${TOKEN}`,
    });
    const detail = failure.detail ?? '';

    expect(detail).toContain('ENOENT');
    expect(detail).not.toContain('ada');
    expect(detail).not.toContain('Users');
    expect(detail).not.toContain('example.com');
    expect(detail).not.toContain(TOKEN);
  });

  it('bounds the detail length', () => {
    const failure = createAntigravityLastFailure('malformed-stream', {
      detail: `invalid-json-at-line-${'9'.repeat(120)}`,
    });
    expect(failure.detail).toBeDefined();
    expect(failure.detail!.length).toBeLessThanOrEqual(ANTIGRAVITY_FAILURE_DETAIL_MAX_LENGTH);
    expect(failure.detail).toContain('invalid-json-at-line-');
  });

  it('drops a prompt-like body instead of storing it as a detail', () => {
    expect(createAntigravityLastFailure('init-failed', { detail: PROMPT_BODY }).detail)
      .toBeUndefined();
  });

  it('drops a blank detail', () => {
    expect(createAntigravityLastFailure('timeout', { detail: '   ' }).detail).toBeUndefined();
  });
});

describe('normalizeAntigravityLastFailure', () => {
  it('keeps a well-formed persisted entry', () => {
    expect(normalizeAntigravityLastFailure({
      category: 'timeout',
      recordedAt: 42,
      detail: 'exit code 1',
    })).toEqual({
      category: 'timeout',
      recordedAt: 42,
      detail: 'exit code 1',
    });
  });

  it('returns null for anything that is not a complete, known entry', () => {
    expect(normalizeAntigravityLastFailure(null)).toBeNull();
    expect(normalizeAntigravityLastFailure(undefined)).toBeNull();
    expect(normalizeAntigravityLastFailure('spawn-failed')).toBeNull();
    expect(normalizeAntigravityLastFailure([])).toBeNull();
    expect(normalizeAntigravityLastFailure({ category: 'spawn-failed' })).toBeNull();
    expect(normalizeAntigravityLastFailure({ category: 'nope', recordedAt: 1 })).toBeNull();
    expect(normalizeAntigravityLastFailure({ category: 'timeout', recordedAt: Number.NaN })).toBeNull();
    expect(normalizeAntigravityLastFailure({ category: 'timeout', recordedAt: 'soon' })).toBeNull();
    expect(normalizeAntigravityLastFailure({ category: 'timeout', recordedAt: 0 })).toBeNull();
  });

  it('re-redacts a detail that was hand-edited into storage', () => {
    const normalized = normalizeAntigravityLastFailure({
      category: 'spawn-failed',
      recordedAt: 1,
      detail: `ENOENT ${PRIVATE_PATH}`,
    });
    expect(normalized?.detail).toBe('ENOENT [redacted-path]');
  });

  it('drops a non-string detail without discarding the entry', () => {
    expect(normalizeAntigravityLastFailure({
      category: 'spawn-failed',
      recordedAt: 1,
      detail: { message: PRIVATE_PATH },
    })).toEqual({ category: 'spawn-failed', recordedAt: 1 });
  });

  it('drops a prompt-like persisted detail', () => {
    expect(normalizeAntigravityLastFailure({
      category: 'init-failed',
      recordedAt: 1,
      detail: PROMPT_BODY,
    })).toEqual({ category: 'init-failed', recordedAt: 1 });
  });
});
