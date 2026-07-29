import { DEFAULT_MEMORY_FILE_PATH, DEFAULT_MEMORY_MAX_INJECTION_CHARS } from '../../core/memory/types';
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
  vaultAutoContextEnabled: true,
  semanticSearchEnabled: false,
  semanticEmbeddingEndpoint: 'http://127.0.0.1:11434',
  semanticEmbeddingModel: 'nomic-embed-text',
  vaultAutoLinkRecommendationsEnabled: false,

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
  enableAutoScroll: true,
  outlineStyle: 'bar',
  deferMathRenderingDuringStreaming: true,
  expandFileEditsByDefault: false,
  chatViewPlacement: 'right-sidebar',

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),

  // Memory system
  memoryEnabled: true,
  memoryFilePath: DEFAULT_MEMORY_FILE_PATH,
  memoryMaxInjectionChars: DEFAULT_MEMORY_MAX_INJECTION_CHARS,

  // Consciousness data can contain personal context and is injected into provider prompts.
  // Require an explicit opt-in on new installations.
  consciousnessEnabled: false,
  consciousnessAutoMemory: false,
};
