const COMPACT_COMMAND_PATTERN = /^\/compact(\s|$)/i;

export function isCompactCommand(text: string): boolean {
  return COMPACT_COMMAND_PATTERN.test(text);
}

export function stripCompactCommand(text: string): string {
  return text.trim().replace(/^\/compact(?:\s|$)/i, '').trim();
}
