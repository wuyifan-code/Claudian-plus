import { NoopTaskResultInterpreter } from '../../core/providers/NoopTaskResultInterpreter';
import type { ProviderModule } from '../../core/providers/types';
import { opencodeWorkspaceRegistration } from './app/OpencodeWorkspaceServices';
import { OpencodeInstructionRefineService } from './auxiliary/OpencodeInstructionRefineService';
import { OpencodeTitleGenerationService } from './auxiliary/OpencodeTitleGenerationService';
import { OPENCODE_PROVIDER_CAPABILITIES } from './capabilities';
import { opencodeSettingsReconciler } from './env/OpencodeSettingsReconciler';
import { OpencodeConversationHistoryService } from './history/OpencodeConversationHistoryService';
import { OpencodeAuxQueryRunner } from './runtime/OpencodeAuxQueryRunner';
import { OpencodeChatRuntime } from './runtime/OpencodeChatRuntime';
import { getOpencodeProviderSettings, updateOpencodeProviderSettings } from './settings';
import { opencodeChatUIConfig } from './ui/OpencodeChatUIConfig';

export const opencodeProviderRegistration: ProviderModule = {
  id: 'opencode',
  blankTabOrder: 10,
  capabilities: OPENCODE_PROVIDER_CAPABILITIES,
  chatUIConfig: opencodeChatUIConfig,
  createInstructionRefineService: (plugin) => new OpencodeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new OpencodeChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new OpencodeTitleGenerationService(plugin),
  createAuxQueryRunner: (plugin) => new OpencodeAuxQueryRunner(plugin, {
    agentProfile: 'passive',
    artifactPurpose: 'dream',
  }),
  displayName: 'OpenCode',
  environmentKeyPatterns: [/^OPENCODE_/i],
  historyService: new OpencodeConversationHistoryService(),
  isEnabled: (settings) => getOpencodeProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateOpencodeProviderSettings(settings, { enabled }),
  settingsReconciler: opencodeSettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    normalizeStored(target, stored) {
      updateOpencodeProviderSettings(target, getOpencodeProviderSettings(stored));
      return false;
    },
  },
  taskResultInterpreter: new NoopTaskResultInterpreter(),
  workspace: opencodeWorkspaceRegistration,
};
