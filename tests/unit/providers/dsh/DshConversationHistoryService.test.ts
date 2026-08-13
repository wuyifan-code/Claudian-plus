import { DshConversationHistoryService } from '@/providers/dsh/history/DshConversationHistoryService';

describe('DshConversationHistoryService', () => {
  const service = new DshConversationHistoryService();

  it('resolves session ids from conversation state without hydration', async () => {
    const conversation = {
      id: 'conv-1',
      providerState: { sessionId: 'dsh-session-1' },
      sessionId: 'dsh-session-1',
    };
    expect(service.resolveSessionIdForConversation(conversation as never)).toBe('dsh-session-1');
    await expect(service.hydrateConversationHistory(conversation as never, null)).resolves.toBeUndefined();
  });

  it('prefers the top-level sessionId over providerState', () => {
    const conversation = {
      id: 'conv-2',
      providerState: { sessionId: 'state-session' },
      sessionId: 'top-session',
    };
    expect(service.resolveSessionIdForConversation(conversation as never)).toBe('top-session');
  });

  it('returns null without provider state', () => {
    expect(service.resolveSessionIdForConversation(null)).toBeNull();
  });

  it('never marks conversations as pending forks', () => {
    expect(service.isPendingForkConversation({ id: 'conv-3' } as never)).toBe(false);
  });

  it('builds persisted provider state only from the session id', () => {
    const conversation = {
      id: 'conv-4',
      providerState: { sessionId: 'dsh-session-4' },
    };
    expect(service.buildPersistedProviderState(conversation as never)).toEqual({
      sessionId: 'dsh-session-4',
    });
  });

  it('omits persisted state without a session id', () => {
    const conversation = { id: 'conv-5', providerState: {} };
    expect(service.buildPersistedProviderState(conversation as never)).toBeUndefined();
  });
});
