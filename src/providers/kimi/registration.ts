import { NoopTaskResultInterpreter } from '../../core/providers/NoopTaskResultInterpreter';
import type { ProviderModule } from '../../core/providers/types';
import { kimiWorkspaceRegistration } from './app/KimiWorkspaceServices';
import { KimiInstructionRefineService } from './auxiliary/KimiInstructionRefineService';
import { KimiTitleGenerationService } from './auxiliary/KimiTitleGenerationService';
import { KIMI_PROVIDER_CAPABILITIES } from './capabilities';
import { kimiSettingsReconciler } from './env/KimiSettingsReconciler';
import { KimiConversationHistoryService } from './history/KimiConversationHistoryService';
import { KimiAuxQueryRunner } from './runtime/KimiAuxQueryRunner';
import { KimiChatRuntime } from './runtime/KimiChatRuntime';
import { getKimiProviderSettings, updateKimiProviderSettings } from './settings';
import { kimiChatUIConfig } from './ui/KimiChatUIConfig';

export const kimiProviderRegistration: ProviderModule = {
  id: 'kimi',
  blankTabOrder: 12,
  capabilities: KIMI_PROVIDER_CAPABILITIES,
  chatUIConfig: kimiChatUIConfig,
  createInstructionRefineService: (plugin) => new KimiInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new KimiChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new KimiTitleGenerationService(plugin),
  createAuxQueryRunner: (plugin) => new KimiAuxQueryRunner(plugin),
  displayName: 'Kimi',
  environmentKeyPatterns: [/^KIMI_/i],
  historyService: new KimiConversationHistoryService(),
  isEnabled: (settings) => getKimiProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateKimiProviderSettings(settings, { enabled }),
  settingsReconciler: kimiSettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    legacyTopLevelFields: [
      'kimiCliPath',
      'kimiCliPathsByHost',
    ],
    normalizeStored(target, stored) {
      updateKimiProviderSettings(target, getKimiProviderSettings(stored));
      return false;
    },
  },
  taskResultInterpreter: new NoopTaskResultInterpreter(),
  workspace: kimiWorkspaceRegistration,
};
