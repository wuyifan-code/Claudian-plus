import type { RuntimeStateStore } from '../app/settings/runtimeState';
import type { ObsidianMcpServerHandle } from '../core/mcp/ObsidianMcpServer';
import type {
  ConsciousnessEngine,
  MemoryStore,
  MicroDreamCoordinator,
  MindStore,
  VaultKnowledgeEngine,
} from '../core/memory';
import type {
  MemoryCoordinator,
  MemoryRepository,
  MemoryRetriever,
} from '../core/memory/v2';
import type { ProviderHost } from '../core/providers/ProviderHost';
import type { AppTabManagerState, ProviderId } from '../core/providers/types';
import type { ChatRuntime } from '../core/runtime/ChatRuntime';
import type { AgentSkillRegistry } from '../core/skills/AgentSkillRegistry';
import type { AgentSkillRepository } from '../core/skills/AgentSkillRepository';
import type { Conversation, ConversationMeta, SessionMetadata } from '../core/types';
import type { ComposerEnhancement } from './chat/composer/types';
import type { TabData, TabId, TabManagerViewHost } from './chat/tabs/types';

export interface FeatureTabManagerHost {
  getAllTabs(): TabData[];
  getOrderedTabs(): TabData[];
  moveTab(tabId: TabId, toIndex: number): void;
  getTab(tabId: TabId): TabData | null;
  switchToTab(tabId: TabId): Promise<void>;
  broadcastToAllTabs(action: (runtime: ChatRuntime) => Promise<void>): Promise<void>;
  recycleProviderRuntimes(providerIds: ProviderId | ProviderId[]): Promise<void>;
  scrollToTurnInTab?(tab: TabData, target: { searchQuery?: string; targetTurnId?: string }): boolean;
}

export interface FeatureViewHost extends TabManagerViewHost {
  getActiveTab(): TabData | null;
  getTabManager(): FeatureTabManagerHost | null;
  refreshModelSelector(): void;
  refreshTabControls(): void;
  /** Re-applies the transcript inset after the padding settings change. */
  applyConversationPadding(): void;
  updateHiddenProviderCommands(): void;
  refreshOutlineSide?(): void;
  /** Re-renders the empty-tab welcome animation after the mode setting changes. */
  refreshWelcomeAnimation?(): void;
  refreshPermissionToggle?(): void;
}

/** Application capabilities consumed by user-facing features. */
export interface FeatureHost extends ProviderHost {
  readonly providerHost: ProviderHost;

  /**
   * Synchronous UI state (onboarding flag, per-install device key) that the
   * plugin persists with its settings instead of the renderer storage.
   */
  getRuntimeStateStore(): RuntimeStateStore;
  /** Get the mind store for legacy mind entries and migration. */
  getMindStore(): MindStore;

  /** Get the micro-dream coordinator for session synthesis. */
  getMicroDreamCoordinator(): MicroDreamCoordinator;

  /** Get the memory store for the memory.md export view. */
  getMemoryStore(): MemoryStore;


  /** Get the consciousness engine for awareness features. */
  getConsciousnessEngine(): ConsciousnessEngine;

  /** Get the unified memory repository (V2). */
  getMemoryRepository(): MemoryRepository;

  /** Get the memory coordinator for turn ingestion and background dreams (V2). */
  getMemoryCoordinator(): MemoryCoordinator;

  /** Get the memory retriever for task-focused context packet generation (V2). */
  getMemoryRetriever(): MemoryRetriever;

  /** Get active chat context including current provider, model, and active file. */
  getActiveChatContext?(): { providerId: ProviderId; model: string | null; activeFilePath?: string } | null;

  /** Get the vault knowledge index for awareness reset and retrieval features. */
  getVaultKnowledgeEngine(): VaultKnowledgeEngine;

  /** Expose native Obsidian tools via local SSE MCP server for Claude Code. */
  ensureObsidianMcpServer?(): Promise<ObsidianMcpServerHandle>;

  getActiveEnvironmentVariables(providerId?: ProviderId): string;

  /** Notifies providers that shared vault agent skills changed. */
  notifyAgentSkillsChanged(): Promise<void>;

  /** Optional live-preview composer enhancement for the chat input. */
  getComposerEnhancement?(): ComposerEnhancement | null;

  /** Shared agent-skill repository for vault .agents/skills management. */
  getAgentSkillRepository(): AgentSkillRepository;

  /** Read-only registry that scans shared skill roots and produces snapshots. */
  getAgentSkillRegistry(): AgentSkillRegistry;

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
  /** Loads the latest persisted session metadata (generated-UI state hydration). */
  loadSessionMetadata?(id: string): Promise<SessionMetadata | null>;
  /** Persists session metadata as-is; callers must merge against the latest on disk. */
  saveSessionMetadata?(metadata: SessionMetadata): Promise<void>;
  getView(): FeatureViewHost | null;
  getAllViews(): FeatureViewHost[];
  findConversationAcrossViews(
    conversationId: string,
  ): { view: FeatureViewHost; tabId: TabId } | null;
}
