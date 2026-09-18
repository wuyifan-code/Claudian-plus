import { NoopTaskResultInterpreter } from '../../core/providers/NoopTaskResultInterpreter';
import type { ProviderModule } from '../../core/providers/types';
import { antigravityWorkspaceRegistration } from './app/AntigravityWorkspaceServices';
import { AntigravityInstructionRefineService } from './auxiliary/AntigravityInstructionRefineService';
import { AntigravityTitleGenerationService } from './auxiliary/AntigravityTitleGenerationService';
import { antigravityProviderCapabilities } from './capabilities';
import { antigravitySettingsReconciler } from './env/AntigravitySettingsReconciler';
import { AntigravityConversationHistoryService } from './history/AntigravityConversationHistoryService';
import { createAntigravityChatRuntime } from './runtime/AntigravityChatRuntime';
import { getAntigravityProviderSettings, updateAntigravityProviderSettings } from './settings';
import { antigravityChatUIConfig } from './ui/AntigravityChatUIConfig';

/**
 * Shipped Antigravity provider module. Disabled by default and never the
 * default chat provider, so enabling it is always an explicit user action.
 *
 * Deliberate omissions, all because no verified path exists (A0, 2026-09-18):
 *
 * - `createAuxQueryRunner` is omitted rather than stubbed. Nothing in the
 *   provider-neutral auxiliary flow requires it: automatic titles come from the
 *   model-free local service below, and micro-dreams/dreams run through the
 *   provider that owns the title model, so no caller reaches a missing runner.
 * - `subagentLifecycleAdapter` is omitted: Antigravity exposes no subagent
 *   lifecycle, and `NoopTaskResultInterpreter` already covers the task-shape
 *   contract.
 * - `environmentKeyPatterns` is omitted: no environment key is verified to
 *   relocate agy state, credentials, or sessions, and guessing one would
 *   invalidate user sessions for no reason.
 *
 * The runtime is built by the provider's own factory, which wires the A4 replay
 * cache; registration never sees the history service's runtime dependencies.
 */
export const antigravityProviderRegistration: ProviderModule = {
  id: 'antigravity',
  blankTabOrder: 13,
  capabilities: antigravityProviderCapabilities,
  chatUIConfig: antigravityChatUIConfig,
  createInstructionRefineService: () => new AntigravityInstructionRefineService(),
  createRuntime: ({ plugin }) => createAntigravityChatRuntime(plugin),
  createTitleGenerationService: () => new AntigravityTitleGenerationService(),
  displayName: 'Antigravity',
  historyService: new AntigravityConversationHistoryService(),
  isEnabled: (settings) => getAntigravityProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateAntigravityProviderSettings(settings, { enabled }),
  settingsReconciler: antigravitySettingsReconciler,
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    normalizeStored(target, stored) {
      updateAntigravityProviderSettings(target, getAntigravityProviderSettings(stored));
      return false;
    },
  },
  taskResultInterpreter: new NoopTaskResultInterpreter(),
  workspace: antigravityWorkspaceRegistration,
};
