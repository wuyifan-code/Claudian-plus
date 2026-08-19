import { parseEnvironmentVariables } from '../../utils/env';
import type { Conversation } from '../types';
import type { ProviderSettingsReconciler } from './types';

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

import { getRuntimeEnvironmentText } from './providerEnvironment';

export interface ProviderSettingsReconcilerConfig {
  providerId: string;
  envHashKeys: readonly string[];
  clearDiscoveryState: (settings: Record<string, unknown>) => boolean;
  getSettings: (settings: Record<string, unknown>) => { environmentHash?: string | null };
  updateSettings: (settings: Record<string, unknown>, updates: Record<string, unknown>) => void;
  /** Provider-specific model variant normalization, delegated unchanged. */
  normalizeModelVariantSettings: (settings: Record<string, unknown>) => boolean;
}

/**
 * Builds a ProviderSettingsReconciler from the shared environment-hash and
 * session-invalidation skeleton. Model variant normalization stays
 * provider-owned.
 */
export function createProviderSettingsReconciler(
  config: ProviderSettingsReconcilerConfig,
): ProviderSettingsReconciler {
  const {
    providerId,
    envHashKeys,
    clearDiscoveryState,
    getSettings,
    updateSettings,
    normalizeModelVariantSettings,
  } = config;

  const invalidateConversationSessions = (conversations: Conversation[]): Conversation[] => (
    invalidateSessionsForProvider(
      conversations,
      providerId,
      (conversation) => typeof conversation.sessionId === 'string' && conversation.sessionId.length > 0,
    )
  );

  return {
    handleEnvironmentChange(settings: Record<string, unknown>): boolean {
      return clearDiscoveryState(settings);
    },

    invalidateConversationSessions,

    reconcileModelWithEnvironment(
      settings: Record<string, unknown>,
      conversations: Conversation[],
    ): { changed: boolean; invalidatedConversations: Conversation[] } {
      const envText = getRuntimeEnvironmentText(settings, providerId);
      const currentHash = computeEnvironmentHash(envText, [...envHashKeys]);
      const savedHash = getSettings(settings).environmentHash;

      if (currentHash === savedHash) {
        return { changed: false, invalidatedConversations: [] };
      }

      const invalidatedConversations = invalidateConversationSessions(conversations);

      updateSettings(settings, { environmentHash: currentHash });
      return { changed: true, invalidatedConversations };
    },

    normalizeModelVariantSettings,
  };
}
