import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getKimiState, type KimiProviderState } from '../types';

/**
 * Kimi session history is owned by the Kimi Code CLI (native `~/.kimi/sessions`
 * store). The ACP protocol exposes `session/list` and `session/load` for
 * resuming, but no message-history read-back, so Claudian Plus never replays
 * Kimi transcripts. Session continuity is preserved through
 * `Conversation.sessionId` + `KimiProviderState.sessionId`; history hydration
 * intentionally leaves the message list untouched.
 */
export class KimiConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // No message-level hydration: Kimi native transcripts are not replayed.
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Never mutate Kimi native history.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    const state = conversation ? getKimiState(conversation.providerState) : null;
    return conversation?.sessionId
      ?? state?.sessionId
      ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {};
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const state = getKimiState(conversation.providerState);
    const providerState: KimiProviderState = {
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    };

    return Object.keys(providerState).length > 0
      ? providerState as Record<string, unknown>
      : undefined;
  }
}
