import type { ChatTurnRequest } from '../../../core/runtime/types';
import type { ChatMessage } from '../../../core/types';
import type { AcpContentBlock } from '../../acp';
import { buildAcpPromptBlocks, buildAcpPromptText } from '../../acp/buildAcpPrompt';

export function buildDshPromptText(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  appendices: string[] = [],
): string {
  return buildAcpPromptText(request, conversationHistory, appendices);
}

export function buildDshPromptBlocks(
  request: ChatTurnRequest,
  conversationHistory: ChatMessage[] = [],
  appendices: string[] = [],
): AcpContentBlock[] {
  return buildAcpPromptBlocks(request, conversationHistory, appendices, false);
}
