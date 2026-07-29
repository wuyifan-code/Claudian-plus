import { StartupProfiler } from '../../core/performance/StartupProfiler';
import { normalizeProviderModelSelection, resolveConversationModel } from '../../core/providers/conversationModel';
import { getRuntimeEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import type { AppSessionStorage, ProviderHistoryPathContext } from '../../core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID, type ProviderId } from '../../core/providers/types';
import type { Conversation, ConversationMeta } from '../../core/types';
import { mapWithConcurrency } from '../../utils/concurrency';
import { extractUserDisplayContent, getConversationSearchText } from '../../utils/context';

export interface ConversationRepositoryDeps {
  getSettings: () => Record<string, unknown>;
  getVaultPath: () => string | null;
  sessions: AppSessionStorage;
  onConversationDeleted: (conversationId: string) => Promise<void>;
}

export class ConversationRepository {
  private conversations: Conversation[] = [];
  private hydratedConversationIds = new Set<string>();
  private hydrationPromises = new Map<string, Promise<Conversation | null>>();
  private conversationGenerations = new Map<string, number>();
  private deletedConversationIds = new Set<string>();
  private metadataSaveTails = new Map<string, Promise<void>>();

  constructor(private readonly deps: ConversationRepositoryDeps) {}

  replaceAll(conversations: Conversation[]): void {
    for (const conversation of this.conversations) {
      this.invalidateConversation(conversation.id);
    }
    this.conversations = conversations;
    this.deletedConversationIds.clear();
    this.hydratedConversationIds = new Set(
      conversations.filter((conversation) => conversation.messages.length > 0).map(({ id }) => id),
    );
    this.hydrationPromises.clear();
  }

  mergeMetadataConversations(conversations: Conversation[]): Conversation[] {
    const existingIds = new Set(this.conversations.map(({ id }) => id));
    const added = conversations.filter(({ id }) => (
      !existingIds.has(id) && !this.deletedConversationIds.has(id)
    ));
    if (added.length === 0) {
      return [];
    }

    this.conversations.push(...added);
    this.conversations.sort(
      (left, right) => (
        (right.lastResponseAt ?? right.updatedAt) - (left.lastResponseAt ?? left.updatedAt)
      ),
    );
    for (const conversation of added) {
      if (conversation.messages.length > 0) {
        this.hydratedConversationIds.add(conversation.id);
      }
    }
    return added;
  }

  getAll(): Conversation[] {
    return this.conversations;
  }

  backfillResponseTimestamps(): Conversation[] {
    const updated: Conversation[] = [];
    for (const conversation of this.conversations) {
      if (conversation.lastResponseAt != null || conversation.messages.length === 0) {
        continue;
      }

      for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
        const message = conversation.messages[index];
        if (message.role === 'assistant') {
          conversation.lastResponseAt = message.timestamp;
          updated.push(conversation);
          break;
        }
      }
    }
    return updated;
  }

  async create(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    selectedModel?: string;
  }): Promise<Conversation> {
    const settings = this.deps.getSettings();
    const providerId = options?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    const sessionId = options?.sessionId;
    const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, providerId);
    const selectedModel = normalizeProviderModelSelection(
      providerId,
      settings,
      options?.selectedModel ?? providerSettings.model,
    ) ?? undefined;
    const conversation: Conversation = {
      id: sessionId ?? this.generateId(),
      providerId,
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: sessionId ?? null,
      selectedModel,
      messages: [],
    };

    this.deletedConversationIds.delete(conversation.id);
    this.conversations.unshift(conversation);
    if (!sessionId) {
      this.hydratedConversationIds.add(conversation.id);
    }
    await this.save(conversation);
    return conversation;
  }

  async switchTo(id: string): Promise<Conversation | null> {
    return this.ensureHydrated(id);
  }

  async delete(
    id: string,
    options: { deleteProviderSession?: boolean } = {},
  ): Promise<void> {
    const index = this.conversations.findIndex(conversation => conversation.id === id);
    if (index === -1) return;

    const conversation = this.conversations[index];
    const pendingHydration = this.hydrationPromises.get(id) ?? null;
    this.deletedConversationIds.add(id);
    this.conversations.splice(index, 1);
    this.hydratedConversationIds.delete(id);
    this.hydrationPromises.delete(id);
    this.invalidateConversation(id);

    if (pendingHydration) {
      await Promise.allSettled([pendingHydration]);
    }
    await this.awaitPendingMetadataSave(id);

    if (options.deleteProviderSession !== false) {
      const vaultPath = this.deps.getVaultPath();
      await ProviderRegistry
        .getConversationHistoryService(conversation.providerId)
        .deleteConversationSession(
          conversation,
          vaultPath,
          this.getHistoryPathContext(conversation.providerId, vaultPath),
        );
    }

    await this.deps.sessions.deleteMetadata(id);
    await this.deps.onConversationDeleted(id);
  }

  async handleMissingProviderSession(
    id: string,
    missingProviderSessionId?: string,
  ): Promise<'deleted' | 'reset' | 'preserved' | 'not_found'> {
    const conversation = this.getSync(id);
    if (!conversation) return 'not_found';

    const historyService = ProviderRegistry.getConversationHistoryService(conversation.providerId);
    if (!historyService.resolveMissingConversationSession) return 'preserved';

    const previousSessionId = conversation.sessionId;
    const previousProviderState = conversation.providerState;
    const previousResumeAtMessageId = conversation.resumeAtMessageId;
    const vaultPath = this.deps.getVaultPath();
    try {
      const resolution = await historyService.resolveMissingConversationSession(
        conversation,
        vaultPath,
        missingProviderSessionId,
        this.getHistoryPathContext(conversation.providerId, vaultPath),
      );
      if (resolution === 'delete') {
        await this.delete(id, { deleteProviderSession: false });
        return 'deleted';
      }
      if (resolution === 'reset') {
        await this.save(conversation);
        return 'reset';
      }
      return 'preserved';
    } catch {
      conversation.sessionId = previousSessionId;
      conversation.providerState = previousProviderState;
      conversation.resumeAtMessageId = previousResumeAtMessageId;
      return 'preserved';
    }
  }

  async rename(id: string, title: string): Promise<void> {
    const conversation = this.getSync(id);
    if (!conversation) return;

    conversation.title = title.trim() || this.generateDefaultTitle();
    conversation.updatedAt = Date.now();
    await this.save(conversation);
  }

  async update(id: string, updates: Partial<Conversation>): Promise<void> {
    const conversation = this.getSync(id);
    if (!conversation) return;

    const safeUpdates = { ...updates };
    delete safeUpdates.providerId;
    if ('selectedModel' in safeUpdates) {
      const selectedModel = normalizeProviderModelSelection(
        conversation.providerId,
        this.deps.getSettings(),
        safeUpdates.selectedModel,
      );
      if (selectedModel) {
        safeUpdates.selectedModel = selectedModel;
      } else {
        delete safeUpdates.selectedModel;
      }
    }
    Object.assign(conversation, safeUpdates, { updatedAt: Date.now() });
    if (
      'sessionId' in safeUpdates
      || 'providerState' in safeUpdates
      || 'resumeAtMessageId' in safeUpdates
    ) {
      this.hydratedConversationIds.delete(id);
      this.invalidateConversation(id);
    }
    await this.save(conversation);
  }

  async getById(id: string): Promise<Conversation | null> {
    return this.ensureHydrated(id);
  }

  getCachedConversation(id: string): Conversation | null {
    return this.getSync(id);
  }

  getMetadata(id: string): ConversationMeta | null {
    const conversation = this.getSync(id);
    if (!conversation) {
      return null;
    }
    const searchText = getConversationSearchText(conversation);
    return {
      id: conversation.id,
      providerId: conversation.providerId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      messageCount: conversation.messages.length,
      preview: this.getPreview(conversation),
      titleGenerationStatus: conversation.titleGenerationStatus,
      ...(searchText ? { searchText } : {}),
    };
  }

  async ensureHydrated(id: string): Promise<Conversation | null> {
    const conversation = this.getSync(id);
    if (!conversation) {
      return null;
    }

    const existing = this.hydrationPromises.get(id);
    if (existing) {
      return existing;
    }

    const generation = this.getConversationGeneration(id);
    const promise = this.hydratedConversationIds.has(id)
      ? this.reconcileHydratedConversation(conversation, generation)
      : this.hydrateConversation(id, generation);
    this.hydrationPromises.set(id, promise);
    try {
      return await promise;
    } finally {
      if (this.hydrationPromises.get(id) === promise) {
        this.hydrationPromises.delete(id);
      }
    }
  }

  private async reconcileHydratedConversation(
    conversation: Conversation,
    generation: number,
  ): Promise<Conversation | null> {
    await this.ensureSelectedModel(conversation);
    return this.isConversationCurrent(conversation, generation) ? conversation : null;
  }

  private async hydrateConversation(
    id: string,
    generation: number,
  ): Promise<Conversation | null> {
    const conversation = this.getSync(id);
    if (!conversation) {
      return null;
    }

    // Reconcile must run first: it may relocate the session and mutate
    // `sessionId`/`providerState`, both of which the history read needs.
    const reconcileSpan = StartupProfiler.start(`hydrate:reconcile-session:${conversation.providerId}`);
    await this.reconcileProviderSession(conversation, generation);
    StartupProfiler.finish(reconcileSpan);
    if (!this.isConversationCurrent(conversation, generation)) return null;

    // `ensureSelectedModel` only reads settings + `selectedModel`; it never
    // depends on session identity. Running it in parallel with the history
    // read saves the model resolution latency on every active-hydration.
    const modelSpan = StartupProfiler.start(`hydrate:ensure-model:${conversation.providerId}`);
    const historySpan = StartupProfiler.start(`hydrate:history:${conversation.providerId}`);
    await Promise.all([
      this.ensureSelectedModel(conversation).finally(() => StartupProfiler.finish(modelSpan)),
      this.hydrateProviderHistory(conversation).finally(() => StartupProfiler.finish(historySpan)),
    ]);
    if (!this.isConversationCurrent(conversation, generation)) return null;

    this.hydratedConversationIds.add(id);
    // Persist the bounded transcript projection so future cold starts can
    // search this conversation without hydrating the provider session again.
    await this.save(conversation);
    return conversation;
  }

  getSync(id: string): Conversation | null {
    return this.conversations.find(conversation => conversation.id === id) ?? null;
  }

  findEmpty(): Conversation | null {
    return this.conversations.find(conversation => conversation.messages.length === 0) ?? null;
  }

  list(): ConversationMeta[] {
    return this.conversations.map(conversation => {
      const searchText = getConversationSearchText(conversation);
      return {
        id: conversation.id,
        providerId: conversation.providerId,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastResponseAt: conversation.lastResponseAt,
        messageCount: conversation.messages.length,
        preview: this.getPreview(conversation),
        titleGenerationStatus: conversation.titleGenerationStatus,
        ...(searchText ? { searchText } : {}),
      };
    });
  }

  /**
   * Hydrates cold-start sessions that do not have a persisted transcript index.
   * This is intentionally opt-in: normal startup remains metadata-only, while
   * an explicit history search can make older sessions searchable in the
   * background without blocking plugin startup.
   */
  async ensureSearchIndex(ids: string[]): Promise<void> {
    const candidates = ids
      .map((id) => this.getSync(id))
      .filter((conversation): conversation is Conversation => (
        conversation !== null
        && conversation.messages.length === 0
        && !conversation.searchText
      ));

    await mapWithConcurrency(candidates, async (conversation) => {
      try {
        await this.ensureHydrated(conversation.id);
      } catch {
        // A provider session can be unavailable independently of the rest of
        // the history. Keep the searchable metadata already on disk intact.
      }
    }, 4);
  }

  private async reconcileProviderSession(
    conversation: Conversation,
    generation: number,
  ): Promise<void> {
    const historyService = ProviderRegistry.getConversationHistoryService(conversation.providerId);
    if (!historyService.getConversationSessionAvailability) return;

    const vaultPath = this.deps.getVaultPath();
    const pathContext = this.getHistoryPathContext(conversation.providerId, vaultPath);
    // Providers may hydrate and mutate the conversation while preparing a
    // relocated session. Work on an isolated candidate until we know this
    // cached conversation has not been replaced or updated in the meantime.
    const relocationCandidate = this.createDetachedConversationCandidate(conversation);
    let availability;
    try {
      availability = await historyService.getConversationSessionAvailability(
        relocationCandidate,
        vaultPath,
        pathContext,
      );
    } catch {
      return;
    }
    if (availability !== 'relocated' || !historyService.prepareRelocatedConversationSession) return;
    if (!this.isConversationCurrent(conversation, generation)) return;

    const previousSessionId = conversation.sessionId;
    const previousProviderState = conversation.providerState;
    const previousResumeAtMessageId = conversation.resumeAtMessageId;
    const previousMessages = conversation.messages;
    let appliedRelocation = false;
    try {
      if (await historyService.prepareRelocatedConversationSession(
        relocationCandidate,
        vaultPath,
        pathContext,
      )) {
        if (!this.isConversationCurrent(conversation, generation)) return;
        conversation.sessionId = relocationCandidate.sessionId;
        conversation.providerState = relocationCandidate.providerState;
        conversation.resumeAtMessageId = relocationCandidate.resumeAtMessageId;
        conversation.messages = relocationCandidate.messages;
        appliedRelocation = true;
        await this.save(conversation);
      }
    } catch {
      if (!appliedRelocation || !this.isConversationCurrent(conversation, generation)) {
        return;
      }
      conversation.sessionId = previousSessionId;
      conversation.providerState = previousProviderState;
      conversation.resumeAtMessageId = previousResumeAtMessageId;
      conversation.messages = previousMessages;
    }
  }

  private createDetachedConversationCandidate(conversation: Conversation): Conversation {
    if (typeof structuredClone === 'function') {
      return structuredClone(conversation);
    }
    return JSON.parse(JSON.stringify(conversation)) as Conversation;
  }

  private async ensureSelectedModel(conversation: Conversation): Promise<void> {
    const resolved = resolveConversationModel(
      this.deps.getSettings(),
      conversation.providerId,
      conversation,
    );
    if (!resolved.shouldPersist || !resolved.model || conversation.selectedModel === resolved.model) return;

    conversation.selectedModel = resolved.model;
    await this.save(conversation);
  }

  private async hydrateProviderHistory(conversation: Conversation): Promise<void> {
    const vaultPath = this.deps.getVaultPath();
    await ProviderRegistry
      .getConversationHistoryService(conversation.providerId)
      .hydrateConversationHistory(
        conversation,
        vaultPath,
        this.getHistoryPathContext(conversation.providerId, vaultPath),
      );
  }

  private getHistoryPathContext(
    providerId: ProviderId,
    vaultPath: string | null = this.deps.getVaultPath(),
  ): ProviderHistoryPathContext {
    const settings = this.deps.getSettings();
    return {
      environment: {
        ...process.env,
        ...getRuntimeEnvironmentVariables(settings, providerId),
      },
      hostPlatform: process.platform,
      settings,
      vaultPath,
    };
  }

  private save(conversation: Conversation): Promise<void> {
    const id = conversation.id;
    const previous = this.metadataSaveTails.get(id);
    const persist = async (): Promise<void> => {
      // A stale async branch must not re-create metadata after delete(), or
      // write a replaced in-memory conversation back to disk.
      if (!this.isPersistable(conversation)) return;
      await this.deps.sessions.saveMetadata(this.deps.sessions.toSessionMetadata(conversation));
    };
    const save = previous
      ? previous.catch(() => undefined).then(persist)
      : persist();
    this.metadataSaveTails.set(id, save);
    void save.finally(() => {
      if (this.metadataSaveTails.get(id) === save) {
        this.metadataSaveTails.delete(id);
      }
    }).catch(() => undefined);
    return save;
  }

  private async awaitPendingMetadataSave(id: string): Promise<void> {
    const pending = this.metadataSaveTails.get(id);
    if (pending) {
      await Promise.allSettled([pending]);
    }
  }

  private isPersistable(conversation: Conversation): boolean {
    return !this.deletedConversationIds.has(conversation.id)
      && this.getSync(conversation.id) === conversation;
  }

  private getConversationGeneration(id: string): number {
    return this.conversationGenerations.get(id) ?? 0;
  }

  private invalidateConversation(id: string): void {
    this.conversationGenerations.set(id, this.getConversationGeneration(id) + 1);
  }

  private isConversationCurrent(conversation: Conversation, generation: number): boolean {
    return this.getSync(conversation.id) === conversation
      && this.getConversationGeneration(conversation.id) === generation;
  }

  private generateId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateDefaultTitle(): string {
    const now = new Date();
    return now.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private getPreview(conversation: Conversation): string {
    const firstUserMessage = conversation.messages.find(message => message.role === 'user');
    if (!firstUserMessage) return 'New conversation';

    const previewText = firstUserMessage.displayContent
      ?? extractUserDisplayContent(firstUserMessage.content)
      ?? firstUserMessage.content;
    return previewText.substring(0, 50) + (previewText.length > 50 ? '...' : '');
  }
}
