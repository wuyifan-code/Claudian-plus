import { parseEnvironmentVariables } from '../../utils/env';
import type { Conversation } from '../types';

/**
 * Stable fingerprint of a provider's environment-relevant variables.
 * Providers persist this in their settings to detect environment changes and
 * invalidate stale sessions.
 */
export function computeEnvironmentHash(
  envText: string,
  keys: readonly string[],
): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return keys
    .filter((key) => envVars[key])
    .map((key) => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

/**
 * Nulls out session state for conversations of a provider whose session no
 * longer matches the current environment.
 */
export function invalidateSessionsForProvider(
  conversations: Conversation[],
  providerId: string,
  hasProviderSession: (conversation: Conversation) => boolean,
): Conversation[] {
  const invalidatedConversations: Conversation[] = [];
  for (const conversation of conversations) {
    if (conversation.providerId !== providerId) {
      continue;
    }

    if (!conversation.sessionId && !hasProviderSession(conversation)) {
      continue;
    }

    conversation.sessionId = null;
    conversation.providerState = undefined;
    invalidatedConversations.push(conversation);
  }
  return invalidatedConversations;
}
