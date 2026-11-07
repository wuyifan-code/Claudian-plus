/**
 * Shared feedback contract.
 *
 * Two independent axes:
 * - `level` is severity. It drives colour and whether the screen reader hears
 *   the entry politely or assertively.
 * - `kind` is the obligation. It says what the user has to do about it, and the
 *   bus enforces the matching action so no failure can land without a next step.
 */

export type FeedbackLevel = 'info' | 'success' | 'warning' | 'error';

/** `blocked` needs configuration, `retryable` needs a retry, `info` needs nothing. */
export type FeedbackKind = 'blocked' | 'retryable' | 'info';

export type FeedbackScope = 'chat' | 'settings' | 'startup';

export interface FeedbackAction {
  id: string;
  label: string;
  run: () => void | Promise<void>;
}

export interface FeedbackEntry {
  id: string;
  level: FeedbackLevel;
  kind: FeedbackKind;
  /** Stable identity used for de-duplication. Format: `surface.operation.outcome`. */
  key: string;
  title: string;
  detail?: string;
  actions?: FeedbackAction[];
  scope: FeedbackScope;
  /** How many times this key fired inside the de-duplication window. */
  count: number;
  /** Last occurrence, epoch ms. */
  at: number;
}

export interface FeedbackState {
  /** Newest first. */
  entries: FeedbackEntry[];
  unread: number;
}

export type FeedbackEmitInput = Omit<FeedbackEntry, 'id' | 'count' | 'at'> & {
  /** Overrides {@link FEEDBACK_DEDUPE_MS} for this key. */
  dedupeMs?: number;
};

export interface FeedbackSugarOptions {
  scope?: FeedbackScope;
  detail?: string;
  actions?: FeedbackAction[];
  dedupeMs?: number;
}

/** Entries kept in memory. Nothing is persisted; feedback is a session-only view. */
export const FEEDBACK_BUFFER_LIMIT = 100;

/** Repeats of the same key inside this window collapse into one counted entry. */
export const FEEDBACK_DEDUPE_MS = 5_000;

/** How long an `info`/`success` toast without actions stays on screen. */
export const FEEDBACK_INFO_TIMEOUT_MS = 3_000;

/** Maximum toasts on screen at once; the rest stay in the activity drawer. */
export const FEEDBACK_TOAST_LIMIT = 3;
