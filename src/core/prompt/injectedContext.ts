/**
 * Shared removal of prompt-injected reference material from user-visible text.
 *
 * Memory and awareness appendices are injected per turn. Providers split into
 * two injection styles: Claude and Codex put them in the system prompt, while
 * the ACP family (Kimi, OpenCode, Pi) and DeepSeek prepend a `<system_context>`
 * block to the user turn. Whatever the transport stores is later echoed back as
 * a user message or replayed from native history, so every visible copy has to
 * be cleaned here or the injected text reads as if the user typed it.
 */

// The client separates the block from the user's prompt with one blank line;
// consuming it with the block avoids leaving a doubled newline mid-text.
const SYSTEM_CONTEXT_BLOCK = /<system_context>[\s\S]*?<\/system_context>(?:[ \t]*\r?\n){0,2}/gi;

/**
 * Removes injected `<system_context>` blocks, keeping the user's own prompt.
 * Matching is case-insensitive and tolerant of the CRLF newline a Windows
 * process may have written into the session file.
 */
export function stripInjectedPromptContext(text: string): string {
  if (!text.includes('<')) {
    return text;
  }
  return text.replace(SYSTEM_CONTEXT_BLOCK, '').trimStart();
}

/** Whether the text still carries an injected context block. */
export function hasInjectedPromptContext(text: string): boolean {
  return /<system_context>/i.test(text);
}
