import { NoopTaskResultInterpreter } from '../../core/providers/NoopTaskResultInterpreter';
import type { ProviderModule } from '../../core/providers/types';
import { dshWorkspaceRegistration, getDshWorkspaceServices } from './app/DshWorkspaceServices';
import { DshInstructionRefineService } from './auxiliary/DshInstructionRefineService';
import { DshTitleGenerationService } from './auxiliary/DshTitleGenerationService';
import { dshProviderCapabilities } from './capabilities';
import { dshSettingsReconciler } from './env/DshSettingsReconciler';
import { createDshHistoryReader } from './history/createDshHistoryReader';
import { DshHistoryService } from './history/DshHistoryService';
import { DshChatRuntime } from './runtime/DshChatRuntime';
import { getDshProviderSettings, updateDshProviderSettings } from './settings';
import { dshChatUIConfig } from './ui/DshChatUIConfig';

export const dshProviderRegistration: ProviderModule = {
  id: 'dsh',
  blankTabOrder: 15,
  displayName: 'DeepSeek Harness',
  capabilities: dshProviderCapabilities,
  chatUIConfig: dshChatUIConfig,
  createRuntime: ({ plugin }) => new DshChatRuntime(plugin, getDshWorkspaceServices().dshHost),
  createInstructionRefineService: () => new DshInstructionRefineService(),
  createTitleGenerationService: () => new DshTitleGenerationService(),
  environmentKeyPatterns: [/^DSH_/i],
  historyService: new DshHistoryService(async () => createDshHistoryReader(getDshWorkspaceServices().dshHost)),
  isEnabled: settings => getDshProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateDshProviderSettings(settings, { enabled }),
  settingsReconciler: dshSettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    normalizeStored(target, stored) {
      updateDshProviderSettings(target, getDshProviderSettings(stored));
      return false;
    },
  },
  taskResultInterpreter: new NoopTaskResultInterpreter(),
  workspace: dshWorkspaceRegistration,
};
