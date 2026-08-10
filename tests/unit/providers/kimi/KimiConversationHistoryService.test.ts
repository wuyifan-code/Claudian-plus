import type { Conversation } from '@/core/types';
import { KimiConversationHistoryService } from '@/providers/kimi/history/KimiConversationHistoryService';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    providerId: 'kimi',
    title: 'Test',
    createdAt: 1,
    updatedAt: 2,
    sessionId: 'session-1',
    messages: [],
    ...overrides,
  } as Conversation;
}

describe('KimiConversationHistoryService', () => {
  let service: KimiConversationHistoryService;

  beforeEach(() => {
    service = new KimiConversationHistoryService();
  });

  it('keeps messages untouched on hydrate (native transcripts are not replayed)', async () => {
    const conversation = createConversation({ messages: [] });
    await service.hydrateConversationHistory(conversation, '/vault');
    expect(conversation.messages).toEqual([]);
  });

  it('never deletes native Kimi sessions', async () => {
    const conversation = createConversation();
    await service.deleteConversationSession(conversation, '/vault');
    expect(conversation.sessionId).toBe('session-1');
  });

  it('resolves the session id from the conversation or provider state', () => {
    expect(service.resolveSessionIdForConversation(createConversation())).toBe('session-1');
    const stateOnly = createConversation({ sessionId: null as unknown as string });
    stateOnly.providerState = { sessionId: 'state-session' };
    expect(service.resolveSessionIdForConversation(stateOnly)).toBe('state-session');
    expect(service.resolveSessionIdForConversation(null)).toBeNull();
  });

  it('builds a persisted provider state carrying the session id', () => {
    const state = service.buildPersistedProviderState(
      createConversation({ providerState: { sessionId: 'session-1' } }),
    );
    expect(state).toEqual({ sessionId: 'session-1' });
  });

  it('returns undefined provider state when nothing is stored', () => {
    expect(service.buildPersistedProviderState(createConversation({ providerState: {} })))
      .toBeUndefined();
  });

  it('does not support fork state', () => {
    expect(service.isPendingForkConversation(createConversation())).toBe(false);
    expect(service.buildForkProviderState('source', 'resume')).toEqual({});
  });
});
