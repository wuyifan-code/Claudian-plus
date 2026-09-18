import {
  ANTIGRAVITY_REDACTED_CONTENT,
  redactAntigravityText,
} from './diagnostics/antigravityRedaction';

/**
 * Bounded record of the most recent Antigravity startup/spawn/init failure.
 *
 * The record exists so the settings tab can answer "why did it not start?"
 * without a log file, so it is deliberately narrow: a closed category
 * vocabulary, a timestamp, and an optional short machine-readable detail. It
 * never carries prompt content, a user name, an absolute path, or a token — the
 * detail is redacted and length-bounded at this boundary, so no caller can
 * persist an unsafe value. Exactly one entry is kept (overwritten in place).
 */
export const ANTIGRAVITY_FAILURE_CATEGORIES = [
  'cli-missing',
  'spawn-failed',
  'init-failed',
  'timeout',
  'malformed-stream',
] as const;

export type AntigravityFailureCategory = (typeof ANTIGRAVITY_FAILURE_CATEGORIES)[number];

export interface AntigravityLastFailure {
  category: AntigravityFailureCategory;
  /** Epoch milliseconds; rendered only by the provider settings tab. */
  recordedAt: number;
  /** Optional bounded, redacted diagnostic code (for example `exit code 1`). */
  detail?: string;
}

export const ANTIGRAVITY_FAILURE_DETAIL_MAX_LENGTH = 120;

export function isAntigravityFailureCategory(value: unknown): value is AntigravityFailureCategory {
  return typeof value === 'string'
    && (ANTIGRAVITY_FAILURE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Bounds and redacts a candidate detail. Returns `undefined` when nothing safe
 * and meaningful is left, so a prompt body can never be stored as a detail.
 */
export function boundAntigravityFailureDetail(raw: string): string | undefined {
  const redacted = redactAntigravityText(raw.trim());
  if (!redacted || redacted === ANTIGRAVITY_REDACTED_CONTENT) {
    return undefined;
  }
  const bounded = redacted.slice(0, ANTIGRAVITY_FAILURE_DETAIL_MAX_LENGTH).trim();
  return bounded || undefined;
}

/**
 * Builds the entry the runtime persists. Throws only for a category outside the
 * closed vocabulary, which is a programming error rather than runtime input.
 */
export function createAntigravityLastFailure(
  category: AntigravityFailureCategory,
  options: { detail?: string | undefined; recordedAt?: number } = {},
): AntigravityLastFailure {
  if (!isAntigravityFailureCategory(category)) {
    throw new RangeError(`createAntigravityLastFailure: unknown category: ${String(category)}`);
  }
  const detail = options.detail === undefined
    ? undefined
    : boundAntigravityFailureDetail(options.detail);
  return {
    category,
    recordedAt: Math.floor(options.recordedAt ?? Date.now()),
    ...(detail !== undefined ? { detail } : {}),
  };
}

/**
 * Lenient read of a persisted record. Hand-edited or legacy storage may hold
 * anything, so an incomplete or unknown entry reads as "nothing recorded"
 * (never as a partial record), and a stored detail is redacted again on the way
 * out so no unsafe value can reach the UI.
 */
export function normalizeAntigravityLastFailure(value: unknown): AntigravityLastFailure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isAntigravityFailureCategory(record.category)) {
    return null;
  }
  const recordedAt = record.recordedAt;
  if (typeof recordedAt !== 'number' || !Number.isFinite(recordedAt) || recordedAt <= 0) {
    return null;
  }
  const detail = typeof record.detail === 'string'
    ? boundAntigravityFailureDetail(record.detail)
    : undefined;
  return {
    category: record.category,
    recordedAt: Math.floor(recordedAt),
    ...(detail !== undefined ? { detail } : {}),
  };
}
