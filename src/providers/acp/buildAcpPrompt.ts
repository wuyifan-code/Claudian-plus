import type { ChatTurnRequest } from '../../core/runtime/types';
import type { ChatMessage, ImageAttachment } from '../../core/types';
import { appendBrowserContext } from '../../utils/browser';
import { appendCanvasContext } from '../../utils/canvas';
import { appendCurrentNote } from '../../utils/context';
import { appendEditorContext } from '../../utils/editor';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../utils/session';
import type { AcpContentBlock } from './types';

const SYSTEM_CONTEXT_OPENING = '<system_context>\n';
const SYSTEM_CONTEXT_CLOSING = '\n</system_context>';

/**
 * Shared ACP prompt assembly. Optional appendices are wrapped in a
 * system_context block; providers without appendices pass an empty array.
 */
export function buildAcpPromptText(
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

export function buildAcpPromptImages(images: ImageAttachment[] | undefined): { data: string; mimeType: string; type: 'image' }[] {
  return (images ?? []).flatMap((image) => {
    if (!image.data) {
      return [];
    }

    return [{
      data: image.data,
      mimeType: image.mediaType,
      type: 'image' as const,
    }];
  });
}

export function buildAcpPromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  appendices: string[] = [],
  includeImages = true,
): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = [
    { type: 'text', text: buildAcpPromptText(request, conversationHistory, appendices) },
  ];

  if (includeImages) {
    blocks.push(...buildAcpPromptImages(request.images));
  }

  return blocks;
}
