import {
  DEFAULT_MEMORY_FILE_PATH,
  DEFAULT_MEMORY_MAX_GLOBAL_INJECTION_CHARS,
  DEFAULT_MEMORY_MAX_INJECTION_CHARS,
  DEFAULT_MEMORY_MAX_INJECTION_TOKENS,
  DEFAULT_MEMORY_MAX_PROJECT_INJECTION_CHARS,
} from '../../core/memory/types';
import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { DEFAULT_REASONING_VALUE } from '../../core/providers/reasoning';
import { type ClaudianPlusSettings } from '../../core/types/settings';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';

export const ENHANCED_DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';

function getEnhancedProviderDefaultConfigs(): ClaudianPlusSettings['providerConfigs'] {
  const providerConfigs = getBuiltInProviderDefaultConfigs();
  providerConfigs.codex = {
    ...providerConfigs.codex,
    enabled: true,
  };
  return providerConfigs;
}

export const DEFAULT_CLAUDIAN_PLUS_SETTINGS: ClaudianPlusSettings = {
  userName: '',

  // A fresh install must not grant an agent approval-free access to the whole
  // machine. Users can still opt into YOLO explicitly from the toolbar.
  permissionMode: 'normal',

  model: ENHANCED_DEFAULT_CODEX_MODEL,
  thinkingBudget: 'off',
  effortLevel: DEFAULT_REASONING_VALUE,
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',
  persistentExternalContextPaths: [],

  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},
  customModelAliases: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,

  enableLivePreviewComposer: true,

  locale: 'en',

  providerConfigs: getEnhancedProviderDefaultConfigs(),

  defaultChatProviderId: '',
  settingsProvider: 'codex',
  savedProviderModel: {
    codex: ENHANCED_DEFAULT_CODEX_MODEL,
  },
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},
  pendingProviderSessionInvalidations: {},

  lastCustomModel: '',

  maxTabs: 3,
  messagesPaddingLeft: 0,
  messagesPaddingRight: 0,
  enableAutoScroll: true,
  outlineSide: 'left',
  deferMathRenderingDuringStreaming: true,
  expandFileEditsByDefault: false,
  chatViewPlacement: 'right-sidebar',
  chatHomeView: 'chat',
  settingsLastCategory: 'general',

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),

  blobFollowPointer: true,

  // Let the model answer with an interactive UI when the question benefits from one.
  generativeUiEnabled: true,

  // Writing model-authored markdown into a note always requires confirmation.
  uiInsertToNoteEnabled: false,

  // Memory system
  memoryEnabled: true,
  memoryFilePath: DEFAULT_MEMORY_FILE_PATH,
  memoryMaxInjectionChars: DEFAULT_MEMORY_MAX_INJECTION_CHARS,
  memoryMaxInjectionTokens: DEFAULT_MEMORY_MAX_INJECTION_TOKENS,
  memoryMaxGlobalInjectionChars: DEFAULT_MEMORY_MAX_GLOBAL_INJECTION_CHARS,
  memoryMaxProjectInjectionChars: DEFAULT_MEMORY_MAX_PROJECT_INJECTION_CHARS,

  // Consciousness data can contain personal context and is injected into provider prompts.
  // Require an explicit opt-in on new installations.
  consciousnessEnabled: false,
  consciousnessAutoMemory: false,

  // Dream memory scheduling follows the consciousness opt-in. The hourly sweep
  // runs retention/GC plus any due V2 dream jobs under the auxiliary gate.
  dreamIntervalMs: 24 * 60 * 60 * 1000,

  // V2 memory maintenance: episodes older than 90 days are pruned by default.
  memoryEpisodeRetentionDays: 90,

  // Saving mode stays `standard` on fresh installs so automatic background
  // behavior is unchanged; the daily cap is unlimited until the user opts in.
  auxiliarySavingMode: 'standard',
  backgroundRequestDailyLimit: null,

  // Ambient context follows the memory opt-in surface but stays on by default:
  // it only reflects what the user is already viewing in the active pane.
  ambientContextEnabled: true,
  ambientMaxContentChars: 32_000,
  ambientMaxOutlineEntries: 50,
  ambientMaxLinks: 25,
  ambientFileModes: {},
};
