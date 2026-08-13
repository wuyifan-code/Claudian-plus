import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { type DshProviderState,getDshState } from '../types';

/**
 * DSH ACP sessions are owned by the dsh process and die with it (fresh
 * sessions only, no resume over the wire), so Claudian Plus never replays DSH
 * transcripts. Conversation continuity inside one process is preserved
 * through `Conversation.sessionId` + `DshProviderState.sessionId`; history
 * hydration intentionally leaves the message list untouched. When a stored
 * session id cannot be resumed, the runtime invalidates it and bootstraps the
 * conversation history into a fresh session.
 */
export class DshConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // No message-level hydration: DSH ACP does not expose transcript replay.
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // DSH native sessions live under the profile's persistence root; leaving
    // them untouched keeps DSH-side observability intact.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    const state = conversation ? getDshState(conversation.providerState) : null;
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
    const state = getDshState(conversation.providerState);
    const providerState: DshProviderState = {
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    };

    return Object.keys(providerState).length > 0
      ? providerState as Record<string, unknown>
      : undefined;
  }
}
