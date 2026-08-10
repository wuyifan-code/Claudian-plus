/**
 * Claudian Plus - Date Utilities
 *
 * Date formatting helpers for system prompts.
 */

/** Returns today's date in readable and ISO format for the system prompt. */
export function getTodayDate(): string {
  const now = new Date();
  const readable = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const iso = now.toISOString().split('T')[0];
  return `${readable} (${iso})`;
}

/** Formats a duration in seconds as "1m 23s" or "45s". */
export function formatDurationMmSs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0s';
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) {
    return `${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

/**
 * Formats a timestamp for conversation-history display: same-day timestamps
 * render as "HH:mm", otherwise as a short month/day.
 */
export function formatConversationTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Formats a duration for human-readable progress/ETA display. `Infinity` and
 * `NaN` collapse to "—"; sub-second durations render as "<1s".
 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  if (totalSeconds < 1) return '<1s';
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds - minutes * 60);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds - hours * 3600) / 60);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
