import { sameStringList } from '../../../core/providers/compareCollections';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import {
  computeEnvironmentHash,
  invalidateSessionsForProvider,
} from '../../../core/providers/settingsReconciler';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { clearKimiDiscoveryState } from '../discoveryState';
import {
  decodeKimiModelId,
  isKimiModelSelectionId,
  normalizeKimiVisibleModels,
} from '../models';
import {
  getKimiProviderSettings,
  hasLegacyKimiDiscoveryFields,
  updateKimiProviderSettings,
} from '../settings';

const KIMI_ENV_HASH_KEYS = [
  'KIMI_CONFIG',
  'KIMI_HOME',
  'KIMI_DATA_DIR',
  'XDG_DATA_HOME',
] as const;

function invalidateKimiConversationSessions(conversations: Conversation[]): Conversation[] {
  return invalidateSessionsForProvider(
    conversations,
    'kimi',
    (conversation) => typeof conversation.sessionId === 'string' && conversation.sessionId.length > 0,
  );
}

export const kimiSettingsReconciler: ProviderSettingsReconciler = {
  handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    return clearKimiDiscoveryState(settings);
  },

  invalidateConversationSessions: invalidateKimiConversationSessions,

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'kimi');
    const currentHash = computeEnvironmentHash(envText, KIMI_ENV_HASH_KEYS);
    const savedHash = getKimiProviderSettings(settings).environmentHash;

    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations = invalidateKimiConversationSessions(conversations);

    updateKimiProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const hadLegacyDiscoveryFields = hasLegacyKimiDiscoveryFields(settings);
    if (hadLegacyDiscoveryFields) {
      updateKimiProviderSettings(settings, {});
    }

    const kimiSettings = getKimiProviderSettings(settings);
    let changed = hadLegacyDiscoveryFields;

    const normalizeSelection = (value: unknown): string | null => {
      if (typeof value !== 'string' || !isKimiModelSelectionId(value)) {
        return null;
      }

      // Keep the full id including any `,thinking` variant; the suffix is part
      // of the Kimi model selection, not a separate effort setting.
      return decodeKimiModelId(value) ? value : null;
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

    const savedProviderModelRaw = settings.savedProviderModel;
    if (savedProviderModelRaw && typeof savedProviderModelRaw === 'object' && !Array.isArray(savedProviderModelRaw)) {
      const savedProviderModel = savedProviderModelRaw as Record<string, unknown>;
      const savedSelection = normalizeSelection(savedProviderModel.kimi);
      if (
        typeof savedProviderModel.kimi === 'string'
        && savedSelection
        && savedProviderModel.kimi !== savedSelection
      ) {
        savedProviderModel.kimi = savedSelection;
        changed = true;
      }
    }

    const normalizedVisibleModels = normalizeKimiVisibleModels(
      kimiSettings.visibleModels,
      kimiSettings.discoveredModels,
    );
    const shouldUpdateProviderSettings = !sameStringList(
      normalizedVisibleModels,
      kimiSettings.visibleModels,
    );
    if (shouldUpdateProviderSettings) {
      updateKimiProviderSettings(settings, {
        visibleModels: normalizedVisibleModels,
      });
      changed = true;
    }

    return changed;
  },
};
