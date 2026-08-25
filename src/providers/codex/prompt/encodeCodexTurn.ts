import { formatAmbientContextXml } from '../../../core/context/ambientFormatter';
import { isCompactCommand } from '../../../core/runtime/compactCommand';
import type { ChatTurnRequest, PreparedChatTurn } from '../../../core/runtime/types';

export function encodeCodexTurn(request: ChatTurnRequest): PreparedChatTurn {
  const isCompact = isCompactCommand(request.text);

  if (isCompact) {
    return {
      request,
      persistedContent: request.text,
      prompt: request.text,
      isCompact: true,
      mcpMentions: new Set(),
    };
  }

  const sections: string[] = [];
  sections.push(request.text);

  if (request.currentNotePath) {
    sections.push(`\n[Current note: ${request.currentNotePath}]`);
  }

  if (request.editorSelection?.selectedText) {
    sections.push(
      `\n[Editor selection from ${request.editorSelection.notePath || 'current note'}:\n${request.editorSelection.selectedText}\n]`,
    );
  }

  if (request.browserSelection?.selectedText) {
    sections.push(
      `\n[Browser selection from ${request.browserSelection.url ?? 'unknown page'}:\n${request.browserSelection.selectedText}\n]`,
    );
  }

  if (request.canvasSelection) {
    const nodeList = request.canvasSelection.nodeIds.join(', ');
    if (nodeList) {
      sections.push(
        `\n[Canvas selection from ${request.canvasSelection.canvasPath}:\n${nodeList}\n]`,
      );
    }
  }

  if (request.ambientContext) {
    const ambientXml = formatAmbientContextXml(request.ambientContext);
    if (ambientXml) {
      sections.push(`\n\n${ambientXml}`);
    }
  }

  const prompt = sections.join('');

  return {
    request,
    persistedContent: request.text,
    prompt,
    isCompact: false,
    mcpMentions: new Set(),
  };
}
