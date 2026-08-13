import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import { appendCurrentNote } from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../../utils/session';
import type { AcpContentBlock } from '../../acp';

const SYSTEM_CONTEXT_OPENING = '<system_context>\n';
const SYSTEM_CONTEXT_CLOSING = '\n</system_context>';

export function buildDshPromptText(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  appendices: string[] = [],
): string {
  const appendixText = appendices.filter((appendix) => appendix.trim()).join('\n\n').trim();
  const systemPrefix = appendixText
    ? `${SYSTEM_CONTEXT_OPENING}${appendixText}${SYSTEM_CONTEXT_CLOSING}\n\n`
    : '';

  let prompt = `${systemPrefix}${request.text}`;

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

  if (conversationHistory.length > 0) {
    const historyContext = buildContextFromHistory(conversationHistory);
    prompt = buildPromptWithHistoryContext(
      historyContext,
      prompt,
      prompt,
      conversationHistory,
    );
  }

  return prompt;
}

export function buildDshPromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  appendices: string[] = [],
): AcpContentBlock[] {
  return [
    { type: 'text', text: buildDshPromptText(request, conversationHistory, appendices) },
  ];
}
