/**
 * Builds the user turn produced by a generated UI's `@ToAssistant` action.
 *
 * The widget may pass a second argument describing what the user selected.
 * That payload is model-authored context, so it is wrapped in an explicit
 * untrusted marker exactly like other host-injected state; the visible text of
 * the message stays the short first-person prompt the model wrote.
 */

/** Upper bound on serialized widget context appended to one turn. */
export const MAX_UI_CONTEXT_CHARS = 16_000;

export function buildUiContinuationPrompt(prompt: string, context: unknown): string {
  const text = prompt.trim();
  if (text.length === 0) return text;
  if (context === undefined || context === null) return text;

  let serialized: string;
  try {
    serialized = JSON.stringify(context);
  } catch {
    return text;
  }

  if (typeof serialized !== 'string' || serialized.length === 0 || serialized === 'null' || serialized === '{}') {
    return text;
  }

  const bounded = serialized.length > MAX_UI_CONTEXT_CHARS
    ? serialized.slice(0, MAX_UI_CONTEXT_CHARS)
    : serialized;

  return `${text}\n\n<untrusted_ui_state>${bounded}</untrusted_ui_state>`;
}
