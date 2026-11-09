import type { FeedbackEntry } from './types';

// Strips terminal color/position codes captured from provider output before
// they reach the clipboard; control chars in a regex body are the mechanism here.
// eslint-disable-next-line no-control-regex -- matching literal \u001b escape sequences
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;
const API_TOKEN = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const NAMED_SECRET = /\b(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi;
const WINDOWS_PATH = /[A-Za-z]:[\\/](?:[^\s/\\'"<>|]+[\\/])*[^\s/\\'"<>|]*/g;
const POSIX_PATH = /\/(?:[^\s/'"<>|]+\/)+[^\s/'"<>|]+/g;

const DETAIL_LIMIT = 200;
const TITLE_LIMIT = 200;
const MAX_ENTRIES = 50;

/**
 * Strips anything that must never leave the machine: credentials, absolute
 * paths (which leak vault and home layout), and terminal escapes.
 *
 * Call sites must still keep prompt bodies out of `detail` — redaction removes
 * secrets and paths, it cannot tell a prompt from an error message.
 */
export function redact(text: string): string {
  return text
    .replace(ANSI_ESCAPE, '')
    .replace(API_TOKEN, '<redacted>')
    .replace(BEARER_TOKEN, 'Bearer <redacted>')
    .replace(NAMED_SECRET, (_match, name: string) => `${name}=<redacted>`)
    .replace(WINDOWS_PATH, '<path>')
    .replace(POSIX_PATH, '<path>');
}

function clamp(text: string, limit: number): string {
  const singleLine = text.replace(/\r?\n/g, ' ');
  return singleLine.length > limit ? `${singleLine.slice(0, limit)}\u2026` : singleLine;
}

function formatTimestamp(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export interface DiagnosticsInput {
  entries: readonly FeedbackEntry[];
  env: Record<string, string>;
  generatedAt?: number;
}

/**
 * Builds the clipboard payload. The same shape is asserted in
 * `tests/unit/shared/feedback/diagnostics.test.ts`: no prompt text, no absolute
 * path, no token.
 */
export function buildDiagnosticsReport({ entries, env, generatedAt }: DiagnosticsInput): string {
  const lines: string[] = ['Claudian Plus diagnostics'];
  lines.push(`generated: ${new Date(generatedAt ?? Date.now()).toISOString()}`);

  for (const [key, value] of Object.entries(env)) {
    lines.push(`${key}: ${clamp(redact(value), DETAIL_LIMIT)}`);
  }

  const visible = entries.slice(0, MAX_ENTRIES);
  lines.push(`recent feedback (${entries.length}):`);

  if (visible.length === 0) {
    lines.push('- (none)');
  }

  for (const entry of visible) {
    lines.push(`- [${formatTimestamp(entry.at)}] ${entry.level}/${entry.kind} ${entry.scope} ${entry.key} x${entry.count}`);
    lines.push(`  title: ${clamp(redact(entry.title), TITLE_LIMIT)}`);
    if (entry.detail) {
      lines.push(`  detail: ${clamp(redact(entry.detail), DETAIL_LIMIT)}`);
    }
    if (entry.actions?.length) {
      lines.push(`  actions: ${entry.actions.map(action => action.id).join(', ')}`);
    }
  }

  return lines.join('\n');
}

/** Copies text to the clipboard. Returns false when the host denies access. */
export async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
