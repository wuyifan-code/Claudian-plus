/**
 * Pure redaction primitives for Antigravity diagnostic text.
 *
 * Diagnostics may be copied out of the vault and pasted into an issue, so a
 * value that reaches a snapshot or a recorded failure is first stripped of
 * anything that could identify a machine or an account: token/secret-shaped
 * strings, email addresses, and absolute paths (including home directories).
 *
 * Free-form prose is not a diagnostic value: a multi-line, long, or
 * sentence-like body is replaced whole, which is how prompt and message content
 * is dropped at the string level (the snapshot projection additionally refuses
 * to read such fields at all).
 *
 * Every function here is pure, offline, and never spawns a process.
 */

export const ANTIGRAVITY_REDACTED_CONTENT = '[redacted-content]';
export const ANTIGRAVITY_REDACTED_EMAIL = '[redacted-email]';
export const ANTIGRAVITY_REDACTED_PATH = '[redacted-path]';
export const ANTIGRAVITY_REDACTED_SECRET = '[redacted-secret]';

const FREE_FORM_MAX_LENGTH = 160;
const FREE_FORM_MAX_TOKENS = 15;

/**
 * Named token shapes plus `keyword: value` assignments. Prefixes are the ones
 * providers actually emit; the keyword branch catches pasted curl/header lines.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bya29\.[0-9A-Za-z._-]{10,}\b/g,
  /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:token|api[_-]?key|secret|password|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._+/=-]{12,}/gi,
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * Path rules are deliberately greedy through spaces: `C:\Users\John Smith\...`
 * and `/Users/John Smith/...` are ordinary homes, and stopping at the first
 * space would leak the account name. They stop at the delimiters that end a
 * value in a diagnostic string (quote, comma, semicolon, parenthesis).
 */
const PATH_TAIL = String.raw`[^"'\r\n;,)]*`;
const WINDOWS_PATH_PATTERN = new RegExp(String.raw`\b[A-Za-z]:[\\/]${PATH_TAIL}`, 'g');
const UNC_PATH_PATTERN = new RegExp(String.raw`\\\\${PATH_TAIL}`, 'g');
const HOME_PATH_PATTERN = new RegExp(String.raw`(?:~|\$(?:HOME|\{HOME\}))[\\/]${PATH_TAIL}`, 'g');
const HOME_ENV_PATH_PATTERN = new RegExp(String.raw`%(?:USERPROFILE|HOME)%[\\/]${PATH_TAIL}`, 'gi');
/**
 * Absolute POSIX paths, recognized by a leading boundary so a relative
 * fragment such as `and/or` is left alone. A segment may contain spaces for the
 * same reason as above. `]` is deliberately not a boundary character, which
 * keeps the replacement marker idempotent.
 */
const POSIX_PATH_PATTERN = /(^|[\s"'(=])\/(?:[\w.@+-]+(?: +[\w.@+-]+)*\/?)+/g;

function looksLikeFreeFormText(text: string): boolean {
  if (text.length > FREE_FORM_MAX_LENGTH) {
    return true;
  }
  if (/[\r\n]/.test(text)) {
    return true;
  }
  return text.split(/\s+/).filter(Boolean).length > FREE_FORM_MAX_TOKENS;
}

/**
 * Strips secret-, email-, and path-shaped substrings from one diagnostic value.
 * Idempotent: feeding its own output back returns the same string.
 */
export function redactAntigravityText(text: string): string {
  if (!text) {
    return text;
  }
  if (looksLikeFreeFormText(text)) {
    return ANTIGRAVITY_REDACTED_CONTENT;
  }

  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, ANTIGRAVITY_REDACTED_SECRET);
  }
  return result
    .replace(EMAIL_PATTERN, ANTIGRAVITY_REDACTED_EMAIL)
    .replace(HOME_ENV_PATH_PATTERN, ANTIGRAVITY_REDACTED_PATH)
    .replace(HOME_PATH_PATTERN, ANTIGRAVITY_REDACTED_PATH)
    .replace(UNC_PATH_PATTERN, ANTIGRAVITY_REDACTED_PATH)
    .replace(WINDOWS_PATH_PATTERN, ANTIGRAVITY_REDACTED_PATH)
    .replace(POSIX_PATH_PATTERN, `$1${ANTIGRAVITY_REDACTED_PATH}`);
}

/**
 * Reduces a path to its last segment, so a diagnostics export can name the
 * executable without disclosing the directory tree it lives in.
 */
export function basenameAntigravityPath(value: string): string {
  const segments = value.trim().split(/[\\/]+/).filter(Boolean);
  return segments.length > 0 ? (segments[segments.length - 1] ?? '') : '';
}
