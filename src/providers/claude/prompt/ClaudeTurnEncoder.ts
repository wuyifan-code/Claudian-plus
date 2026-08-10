import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import { isCompactCommand } from '../../../core/runtime/compactCommand';
import type { ChatTurnRequest, PreparedChatTurn } from '../../../core/runtime/types';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import { appendCurrentNote } from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';

export function encodeClaudeTurn(
  request: ChatTurnRequest,
  mcpManager: Pick<McpServerManager, 'extractMentions' | 'transformMentions'>,
): PreparedChatTurn {
  const isCompact = isCompactCommand(request.text);

  let persistedContent = request.text;
  if (!isCompact) {
    if (request.currentNotePath) {
      persistedContent = appendCurrentNote(persistedContent, request.currentNotePath);
    }

    if (request.editorSelection) {
      persistedContent = appendEditorContext(persistedContent, request.editorSelection);
    }

    if (request.browserSelection) {
      persistedContent = appendBrowserContext(persistedContent, request.browserSelection);
    }

    if (request.canvasSelection) {
      persistedContent = appendCanvasContext(persistedContent, request.canvasSelection);
    }
  }

  const mcpMentions = mcpManager.extractMentions(persistedContent);
  const prompt = mcpManager.transformMentions(persistedContent);

  return {
    request,
    persistedContent,
    prompt,
    isCompact,
    mcpMentions,
  };
}
