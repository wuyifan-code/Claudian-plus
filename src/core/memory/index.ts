export {
  type ActivityContextInput,
  buildActivityContext,
  wrapActivityContext,
} from './activityContext';
export { ConsciousnessEngine } from './ConsciousnessEngine';
export {
  deduplicateMemoryEntries,
  isMemoryDuplicate,
  MIN_CONTAINMENT_LENGTH,
  normalizeMemoryContent,
} from './deduplication';
export { IdleActivityObserver, type IdleActivityObserverOptions } from './IdleActivityObserver';
export { escapePromptTagCloser, formatMemoryAppendix, wrapMemoryInjection } from './memoryPrompt';
export { MemoryStore } from './MemoryStore';
export {
  MicroDreamCoordinator,
  type MicroDreamRunResult,
  type SessionEvaluationInput,
  type SessionMessageInput,
} from './MicroDreamCoordinator';
export type {
  DurableMindEntry,
  MindCategory,
  MindScope,
  MindStoreData,
  MindTemporalState,
  StagingMindEntry,
  StagingStoreData,
} from './mind-types';
export { MindStore } from './MindStore';
export {
  deriveProjectIdFromGitConfig,
  deriveProjectIdFromVaultName,
} from './projectScope';
export { VaultKnowledgeEngine } from './VaultKnowledgeEngine';
