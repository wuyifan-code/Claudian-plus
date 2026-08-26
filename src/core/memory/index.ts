export { ConsciousnessEngine } from './ConsciousnessEngine';
export {
  DREAM_CHECK_INTERVAL_MS,
  DreamService,
} from './DreamService';
export { HybridMindPromptInjector, type MindPromptContext } from './HybridMindPromptInjector';
export { MemoryExtractor } from './MemoryExtractor';
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
export { VaultKnowledgeEngine } from './VaultKnowledgeEngine';
