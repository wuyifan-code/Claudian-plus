import { formatAmbientContextXml } from '../../../core/context/ambientFormatter';
import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import { appendCurrentNote } from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';

/**
 * Encodes the provider prompt for one Antigravity print-mode turn (`agy -p <prompt>`).
 *
 * Multi-turn memory is owned by the CLI itself: a follow-up turn resumes the
 * server-side conversation through the verified `--conversation <id>` path, so
 * conversation history is deliberately NOT re-encoded here — replaying it would
 * duplicate context the CLI already holds (A0: resumed turns re-read the cached
 * context, `cache_read_tokens` > 0). Visible-transcript replay after a restart
 * is the history service's responsibility (roadmap A4), not the prompt's.
 *
 * Images are never encoded: image attachments are not a verified Antigravity
 * capability (`supportsImageAttachments: false`), and the feature layer keeps
 * the attachment path disabled for this provider.
 */
export function buildAntigravityPrompt(
  request: ChatTurnRequest,
  _conversationHistory: ChatMessage[] = [],
): string {
  let prompt = request.text;

  if (request.currentNotePath) {
    prompt = appendCurrentNote(prompt, request.currentNotePath);
  }

  if (request.editorSelection && request.editorSelection.mode !== 'none') {
    prompt = appendEditorContext(prompt, request.editorSelection);
  }

  if (request.browserSelection) {
    prompt = appendBrowserContext(prompt, request.browserSelection);
  }

  if (request.canvasSelection) {
    prompt = appendCanvasContext(prompt, request.canvasSelection);
  }

  if (request.ambientContext) {
    const ambientXml = formatAmbientContextXml(request.ambientContext);
    if (ambientXml) {
      prompt = `${prompt}\n\n${ambientXml}`;
    }
  }

  return prompt;
}
