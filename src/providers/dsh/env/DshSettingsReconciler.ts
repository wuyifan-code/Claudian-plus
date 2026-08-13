import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import {
  computeEnvironmentHash,
  invalidateSessionsForProvider,
} from '../../../core/providers/settingsReconciler';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { clearDshDiscoveryState } from '../discoveryState';
import {
  decodeDshModelId,
  isDshModelSelectionId,
  normalizeDshVisibleModels,
} from '../models';
import {
  getDshProviderSettings,
  updateDshProviderSettings,
} from '../settings';

const DSH_ENV_HASH_KEYS = [
  'DSH_HOME',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
] as const;

function invalidateDshConversationSessions(conversations: Conversation[]): Conversation[] {
  return invalidateSessionsForProvider(
    conversations,
    'dsh',
    (conversation) => typeof conversation.sessionId === 'string' && conversation.sessionId.length > 0,
  );
}

export const dshSettingsReconciler: ProviderSettingsReconciler = {
  handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    return clearDshDiscoveryState(settings);
  },

  invalidateConversationSessions: invalidateDshConversationSessions,

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'dsh');
    const currentHash = computeEnvironmentHash(envText, DSH_ENV_HASH_KEYS);
    const savedHash = getDshProviderSettings(settings).environmentHash;

    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations = invalidateDshConversationSessions(conversations);

    updateDshProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    let changed = false;

    const normalizeSelection = (value: unknown): string | null => {
      if (typeof value !== 'string' || !isDshModelSelectionId(value)) {
        return null;
      }
      return decodeDshModelId(value) ? value : null;
    };

    const modelSelection = normalizeSelection(settings.model);
    if (typeof settings.model === 'string' && modelSelection && settings.model !== modelSelection) {
      settings.model = modelSelection;
      changed = true;
    }

    const titleModelSelection = normalizeSelection(settings.titleGenerationModel);
    if (
      typeof settings.titleGenerationModel === 'string'
      && titleModelSelection
      && settings.titleGenerationModel !== titleModelSelection
    ) {
      settings.titleGenerationModel = titleModelSelection;
      changed = true;
    }

    const dshSettings = getDshProviderSettings(settings);
    const normalizedVisibleModels = normalizeDshVisibleModels(dshSettings.visibleModels);
    if (JSON.stringify(normalizedVisibleModels) !== JSON.stringify(dshSettings.visibleModels)) {
      updateDshProviderSettings(settings, { visibleModels: normalizedVisibleModels });
      changed = true;
    }

    return changed;
  },
};
