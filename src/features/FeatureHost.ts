import type {
  ConsciousnessEngine,
  DreamService,
  MemoryExtractor,
  MemoryStore,
  VaultKnowledgeEngine,
} from '../core/memory';
import type { ProviderHost } from '../core/providers/ProviderHost';
import type { AppTabManagerState, ProviderId } from '../core/providers/types';
import type { ChatRuntime } from '../core/runtime/ChatRuntime';
import type { AgentSkillRepository } from '../core/skills/AgentSkillRepository';
import type { Conversation, ConversationMeta } from '../core/types';
import type { ComposerEnhancement } from './chat/composer/types';
import type { TabData, TabId, TabManagerViewHost } from './chat/tabs/types';

export interface FeatureTabManagerHost {
  getAllTabs(): TabData[];
  getTab(tabId: TabId): TabData | null;
  switchToTab(tabId: TabId): Promise<void>;
  broadcastToAllTabs(action: (runtime: ChatRuntime) => Promise<void>): Promise<void>;
  recycleProviderRuntimes(providerIds: ProviderId | ProviderId[]): Promise<void>;
}

export interface FeatureViewHost extends TabManagerViewHost {
  getActiveTab(): TabData | null;
  getTabManager(): FeatureTabManagerHost | null;
  refreshModelSelector(): void;
  refreshTabControls(): void;
  updateHiddenProviderCommands(): void;
  refreshOutlineSide?(): void;
}

/** Application capabilities consumed by user-facing features. */
export interface FeatureHost extends ProviderHost {
  readonly providerHost: ProviderHost;
  readonly memoryExtractor: MemoryExtractor;

  /** Get the memory store for saving/loading user memories. */
  getMemoryStore(): MemoryStore;

  /** Get the consciousness engine for awareness features. */
  getConsciousnessEngine(): ConsciousnessEngine;

  /** Get the dream memory consolidation service. */
  getDreamService(): DreamService;

  /** Get the vault knowledge index for awareness reset and retrieval features. */
  getVaultKnowledgeEngine(): VaultKnowledgeEngine;

  getActiveEnvironmentVariables(providerId?: ProviderId): string;

  /** Notifies providers that shared vault agent skills changed. */
  notifyAgentSkillsChanged(): Promise<void>;

  /** Optional live-preview composer enhancement for the chat input. */
  getComposerEnhancement?(): ComposerEnhancement | null;

  /** Shared agent-skill repository for vault .agents/skills management. */
  getAgentSkillRepository(): AgentSkillRepository;

  createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    selectedModel?: string;
  }): Promise<Conversation>;
  switchConversation(id: string): Promise<Conversation | null>;
  deleteConversation(
    id: string,
    options?: { deleteProviderSession?: boolean },
  ): Promise<void>;
  handleMissingProviderSession(
    id: string,
    missingProviderSessionId?: string,
  ): Promise<'deleted' | 'reset' | 'preserved' | 'not_found'>;
  renameConversation(id: string, title: string): Promise<void>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<void>;
  getConversationById(id: string): Promise<Conversation | null>;
  getCachedConversation(id: string): Conversation | null;
  getConversationSync(id: string): Conversation | null;
  getConversationList(): ConversationMeta[];
  /** Builds missing cold-start transcript indexes for explicit history search. */
  ensureConversationSearchIndex?(ids: string[]): Promise<void>;

  persistTabManagerState(state: AppTabManagerState): Promise<void>;
  getView(): FeatureViewHost | null;
  getAllViews(): FeatureViewHost[];
  findConversationAcrossViews(
    conversationId: string,
  ): { view: FeatureViewHost; tabId: TabId } | null;
}
