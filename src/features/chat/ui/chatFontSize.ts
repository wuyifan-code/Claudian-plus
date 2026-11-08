/**
 * Chat body type scale, owned by this plugin rather than Obsidian.
 *
 * The host's "Font size" setting only scales editor text, so a reader who wants
 * larger chat answers had no lever. `0` means "follow the theme" and removes the
 * override entirely, which keeps the default identical to what shipped before.
 */
export const CHAT_FONT_SIZE_OPTIONS = [0, 13, 14, 15, 16, 17, 18, 20] as const;

export type ChatFontSize = (typeof CHAT_FONT_SIZE_OPTIONS)[number];

export function normalizeChatFontSize(value: unknown): number {
  const size = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(size) || size <= 0) {
    return 0;
  }
  const clamped = Math.min(24, Math.max(11, Math.round(size)));
  return clamped;
}

/** CSS custom property for the container; empty when the theme should win. */
export function chatFontSizeStyle(size: number): Record<string, string> {
  const normalized = normalizeChatFontSize(size);
  return normalized > 0 ? { '--claudian-plus-chat-font-size': `${normalized}px` } : {};
}
