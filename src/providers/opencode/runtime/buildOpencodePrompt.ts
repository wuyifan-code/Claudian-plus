import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import type { AcpContentBlock } from '../../acp';
import { buildAcpPromptBlocks, buildAcpPromptText } from '../../acp/buildAcpPrompt';

export function buildOpencodePromptText(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
): string {
  return buildAcpPromptText(request, conversationHistory, []);
}

export function buildOpencodePromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
): AcpContentBlock[] {
  return buildAcpPromptBlocks(request, conversationHistory, [], true);
}
