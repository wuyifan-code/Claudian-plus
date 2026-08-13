import { NoopTaskResultInterpreter } from '../../core/providers/NoopTaskResultInterpreter';
import type { ProviderModule } from '../../core/providers/types';
import { dshWorkspaceRegistration } from './app/DshWorkspaceServices';
import { DshInstructionRefineService } from './auxiliary/DshInstructionRefineService';
import { DshTitleGenerationService } from './auxiliary/DshTitleGenerationService';
import { DSH_PROVIDER_CAPABILITIES } from './capabilities';
import { dshSettingsReconciler } from './env/DshSettingsReconciler';
import { DshConversationHistoryService } from './history/DshConversationHistoryService';
import { DshAuxQueryRunner } from './runtime/DshAuxQueryRunner';
import { DshChatRuntime } from './runtime/DshChatRuntime';
import { getDshProviderSettings, updateDshProviderSettings } from './settings';
import { dshSubagentLifecycleAdapter } from './subagent/DshSubagentLifecycleAdapter';
import { dshChatUIConfig } from './ui/DshChatUIConfig';

export const dshProviderRegistration: ProviderModule = {
  id: 'dsh',
  blankTabOrder: 13,
  capabilities: DSH_PROVIDER_CAPABILITIES,
  chatUIConfig: dshChatUIConfig,
  createInstructionRefineService: (plugin) => new DshInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new DshChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new DshTitleGenerationService(plugin),
  createAuxQueryRunner: (plugin) => new DshAuxQueryRunner(plugin),
  displayName: 'DeepSeek',
  environmentKeyPatterns: [/^DSH_/i, /^DEEPSEEK_/i],
  historyService: new DshConversationHistoryService(),
  isEnabled: (settings) => getDshProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateDshProviderSettings(settings, { enabled }),
  settingsReconciler: dshSettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    normalizeStored(target, stored) {
      updateDshProviderSettings(target, getDshProviderSettings(stored));
      return false;
    },
  },
  subagentLifecycleAdapter: dshSubagentLifecycleAdapter,
  taskResultInterpreter: new NoopTaskResultInterpreter(),
  workspace: dshWorkspaceRegistration,
};
