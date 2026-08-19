import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage, ImageAttachment } from '../../../core/types';
import { buildAcpPromptImages, buildAcpPromptText } from '../../acp/buildAcpPrompt';

export interface PiPromptImage {
  data: string;
  mimeType: string;
  type: 'image';
}

export function buildPiPromptText(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
): string {
  return buildAcpPromptText(request, conversationHistory, []);
}

export function buildPiPromptImages(images: ImageAttachment[] | undefined): PiPromptImage[] {
  return buildAcpPromptImages(images);
}
