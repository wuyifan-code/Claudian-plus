import '@/providers';

import { ConversationRepository } from '@/app/conversations/ConversationRepository';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { Conversation } from '@/core/types';

function createConversation(id = 'conversation-1'): Conversation {
  return {
    id,
    providerId: 'claude',
    title: 'Conversation',
    createdAt: 1,
    updatedAt: 1,
    sessionId: 'session-1',
    messages: [],
  };
}

function createRepository(conversation = createConversation()) {
  const sessions = {
    saveMetadata: jest.fn().mockResolvedValue(undefined),
    deleteMetadata: jest.fn().mockResolvedValue(undefined),
    toSessionMetadata: jest.fn((value) => value),
  };
  const repository = new ConversationRepository({
    getSettings: () => ({}),
    getVaultPath: () => '/vault',
    sessions: sessions as any,
    onConversationDeleted: jest.fn().mockResolvedValue(undefined),
  });
  repository.replaceAll([conversation]);
  return { repository, sessions };
}

describe('ConversationRepository hydration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('waits for an in-flight metadata save before deleting the conversation metadata', async () => {
    const { repository, sessions } = createRepository();
    let finishSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    sessions.saveMetadata.mockReturnValueOnce(pendingSave);

    const updatePromise = repository.update('conversation-1', { title: 'New title' });
    await Promise.resolve();
    const deletePromise = repository.delete('conversation-1', { deleteProviderSession: false });
    await Promise.resolve();

    expect(sessions.deleteMetadata).not.toHaveBeenCalled();

    finishSave();
    await Promise.all([updatePromise, deletePromise]);

    expect(sessions.deleteMetadata).toHaveBeenCalledWith('conversation-1');
    expect(repository.getSync('conversation-1')).toBeNull();
  });

  it('returns cached metadata without hydrating provider history', () => {
    const hydrateConversationHistory = jest.fn();
    jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      hydrateConversationHistory,
    } as any);
    const conversation = createConversation();
    const { repository } = createRepository(conversation);

    expect(repository.getCachedConversation(conversation.id)).toBe(conversation);
    expect(hydrateConversationHistory).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent hydration and does not reread an empty transcript', async () => {
    let release!: () => void;
    const hydrateConversationHistory = jest.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      hydrateConversationHistory,
    } as any);
    const conversation = createConversation();
    const { repository } = createRepository(conversation);

    const first = repository.ensureHydrated(conversation.id);
    const second = repository.ensureHydrated(conversation.id);
    await Promise.resolve();
    await Promise.resolve();
    expect(hydrateConversationHistory).toHaveBeenCalledTimes(1);

    release();
    await expect(Promise.all([first, second])).resolves.toEqual([conversation, conversation]);
    await repository.ensureHydrated(conversation.id);

    expect(hydrateConversationHistory).toHaveBeenCalledTimes(1);
  });

  it('allows hydration to retry after a provider history failure', async () => {
    const hydrateConversationHistory = jest.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);
    jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      hydrateConversationHistory,
    } as any);
    const conversation = createConversation();
    const { repository } = createRepository(conversation);

    await expect(repository.ensureHydrated(conversation.id)).rejects.toThrow('temporary failure');
    await expect(repository.ensureHydrated(conversation.id)).resolves.toBe(conversation);

    expect(hydrateConversationHistory).toHaveBeenCalledTimes(2);
  });

  it('builds and persists transcript indexes for cold-start history search', async () => {
    const hydrateConversationHistory = jest.fn(async (conversation: Conversation) => {
      conversation.messages = [{
        id: 'message-1',
        role: 'user',
        content: 'Please map the vault memory architecture',
        timestamp: 2,
      }];
    });
    jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      hydrateConversationHistory,
    } as any);
    const conversation = createConversation();
    const { repository, sessions } = createRepository(conversation);

    await repository.ensureSearchIndex([conversation.id]);

    expect(hydrateConversationHistory).toHaveBeenCalledTimes(1);
    expect(repository.list()[0].searchText).toContain('vault memory architecture');
    expect(sessions.saveMetadata).toHaveBeenCalled();
  });

  it('does not return a conversation deleted while hydration is in flight', async () => {
    let releaseHydration!: () => void;
    const hydrateConversationHistory = jest.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseHydration = resolve;
      });
    });
    jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      hydrateConversationHistory,
    } as any);
    const conversation = createConversation();
    const { repository, sessions } = createRepository(conversation);

    const hydration = repository.ensureHydrated(conversation.id);
    await Promise.resolve();
    await Promise.resolve();
    const deletion = repository.delete(conversation.id, { deleteProviderSession: false });

    releaseHydration();

    await expect(hydration).resolves.toBeNull();
    await expect(deletion).resolves.toBeUndefined();
    expect(repository.getCachedConversation(conversation.id)).toBeNull();
    expect(sessions.deleteMetadata).toHaveBeenCalledWith(conversation.id);
  });

  it('does not return an already hydrated conversation deleted while model reconciliation is in flight', async () => {
    let markReconciliationStarted!: () => void;
    let releaseReconciliation!: () => void;
    const reconciliationStarted = new Promise<void>((resolve) => {
      markReconciliationStarted = resolve;
    });
    const reconciliationRelease = new Promise<void>((resolve) => {
      releaseReconciliation = resolve;
    });
    const conversation = createConversation();
    conversation.messages = [{ id: 'message-1', role: 'user', content: 'kept', timestamp: 1 }];
    const { repository, sessions } = createRepository(conversation);
    jest.spyOn(repository as any, 'ensureSelectedModel').mockImplementation(async () => {
      markReconciliationStarted();
      await reconciliationRelease;
    });

    const hydration = repository.ensureHydrated(conversation.id);
    await reconciliationStarted;
    const deletion = repository.delete(conversation.id, { deleteProviderSession: false });
    releaseReconciliation();

    await expect(hydration).resolves.toBeNull();
    await expect(deletion).resolves.toBeUndefined();
    expect(repository.getCachedConversation(conversation.id)).toBeNull();
    expect(sessions.deleteMetadata).toHaveBeenCalledWith(conversation.id);
  });

  it('restarts hydration when provider session identity changes in flight', async () => {
    let markFirstHydrationStarted!: () => void;
    let releaseFirstHydration!: () => void;
    const firstHydrationStarted = new Promise<void>((resolve) => {
      markFirstHydrationStarted = resolve;
    });
    const firstHydrationRelease = new Promise<void>((resolve) => {
      releaseFirstHydration = resolve;
    });
    const hydrateConversationHistory = jest.fn()
      .mockImplementationOnce(async () => {
        markFirstHydrationStarted();
        await firstHydrationRelease;
      })
      .mockResolvedValueOnce(undefined);
    jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      hydrateConversationHistory,
    } as any);
    const conversation = createConversation();
    const { repository } = createRepository(conversation);

    const staleHydration = repository.ensureHydrated(conversation.id);
    await firstHydrationStarted;
    await repository.update(conversation.id, { sessionId: 'session-2' });
    releaseFirstHydration();

    await expect(staleHydration).resolves.toBeNull();
    await expect(repository.ensureHydrated(conversation.id)).resolves.toBe(conversation);
    expect(hydrateConversationHistory).toHaveBeenCalledTimes(2);
  });

  it('does not let a late relocated-session preparation overwrite a newer session update', async () => {
    let markPreparationStarted!: () => void;
    let releasePreparation!: () => void;
    const preparationStarted = new Promise<void>((resolve) => {
      markPreparationStarted = resolve;
    });
    const preparationRelease = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const prepareRelocatedConversationSession = jest.fn(async (candidate: Conversation) => {
      markPreparationStarted();
      await preparationRelease;
      candidate.sessionId = null;
      candidate.providerState = { previousProviderSessionIds: ['session-1'] };
      return true;
    });
    jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
      getConversationSessionAvailability: jest.fn().mockResolvedValue('relocated'),
      prepareRelocatedConversationSession,
      hydrateConversationHistory: jest.fn(),
    } as any);
    const conversation = createConversation();
    const { repository } = createRepository(conversation);

    const hydration = repository.ensureHydrated(conversation.id);
    await preparationStarted;
    await repository.update(conversation.id, {
      sessionId: 'session-new',
      providerState: { source: 'new-session' },
    });
    releasePreparation();

    await expect(hydration).resolves.toBeNull();
    expect(repository.getSync(conversation.id)).toEqual(expect.objectContaining({
      sessionId: 'session-new',
      providerState: { source: 'new-session' },
    }));
  });

  it('merges background metadata without replacing an already hydrated conversation', () => {
    const existing = createConversation('existing');
    existing.messages = [{ id: 'message-1', role: 'user', content: 'kept', timestamp: 1 }];
    const { repository } = createRepository(existing);
    const duplicate = createConversation('existing');
    const added = createConversation('added');
    added.updatedAt = 2;

    const merged = repository.mergeMetadataConversations([duplicate, added]);

    expect(merged).toEqual([added]);
    expect(repository.getCachedConversation('existing')).toBe(existing);
    expect(repository.getCachedConversation('existing')?.messages).toHaveLength(1);
    expect(repository.getAll().map(conversation => conversation.id)).toEqual(['added', 'existing']);
  });

  it('does not resurrect a deleted conversation from a late background metadata batch', async () => {
    const conversation = createConversation('deleted');
    const { repository } = createRepository(conversation);
    await repository.delete(conversation.id, { deleteProviderSession: false });

    const merged = repository.mergeMetadataConversations([
      createConversation(conversation.id),
    ]);

    expect(merged).toEqual([]);
    expect(repository.getCachedConversation(conversation.id)).toBeNull();
  });
});
