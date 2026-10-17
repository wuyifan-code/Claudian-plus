import type { Conversation } from '@/core/types/chat';
import { type DshHistoryReader,DshHistoryService } from '@/providers/dsh/history/DshHistoryService';

const record = (seq: number, role: 'user' | 'assistant', text: string) => ({
  type: 'event', event: { type: `${role}/message`, seq, time: 100 + seq, surfaceOp: 'append', data: role === 'user'
    ? { id: `m${seq}`, role, source: { kind: 'user' }, content: [{ type: 'text', text }] }
    : { turn: 1, step: 1, message: { id: `m${seq}`, role, source: { kind: 'model' }, content: [{ type: 'text', text }] }, stream: [] } },
});
const conversation = (): Conversation => ({ id: 'local', providerId: 'dsh', title: 'Native', createdAt: 1, updatedAt: 1,
  sessionId: 'native', providerState: { schemaVersion: 1, backend: 'native', home: '/native', preset: 'build', extra: true }, messages: [],
});
const reader = () => ({
  home: '/native', preset: 'build',
  snapshot: jest.fn().mockResolvedValue({ cursor: 2, records: [record(2, 'assistant', 'End')], hasMore: true }),
  call: jest.fn().mockResolvedValue({ records: [record(0, 'user', 'Start'), record(1, 'assistant', 'Middle')], hasMore: false }),
});

describe('DSH native cold history', () => {
  it('pages backwards with the opening cut fixed and commits a complete projection atomically', async () => {
    const port = reader();
    const resolve = jest.fn().mockResolvedValue(port);
    const service = new DshHistoryService(resolve);
    const conv = conversation();
    await service.hydrateConversationHistory(conv, '/vault');
    expect(port.snapshot).toHaveBeenCalledWith('native');
    expect(port.call).toHaveBeenCalledWith('session/page', { request: { address: { kind: 'session', sessionId: 'native' }, throughSeq: 2, beforeSeq: 2, maxMessages: 100 } });
    expect(conv.messages.map(item => item.content)).toEqual(['Start', 'Middle', 'End']);
    expect(conv.providerState).toEqual({ schemaVersion: 1, backend: 'native', home: '/native', preset: 'build', extra: true });
  });

  it('preserves unknown legacy state and messages without opening native history', async () => {
    const resolve = jest.fn();
    const service = new DshHistoryService(resolve);
    const conv = conversation();
    conv.providerState = { schemaVersion: 1, sessionId: 'legacy', marker: 'preserve' };
    conv.messages = [{ id: 'old', role: 'user', content: 'Legacy', timestamp: 1 }];
    await service.hydrateConversationHistory(conv, '/vault');
    expect(resolve).not.toHaveBeenCalled();
    expect(conv.messages[0].content).toBe('Legacy');
    expect(await service.resolveMissingConversationSession(conv, '/vault')).toBe('preserve');
    await service.deleteConversationSession(conv, '/vault');
    expect(conv.providerState.marker).toBe('preserve');
  });

  it('preserves local data on failed reads, repeated pages and identity mismatches', async () => {
    for (const mode of ['failed', 'repeated', 'identity', 'future']) {
      const port = reader();
      if (mode === 'failed') port.call.mockRejectedValue(new Error('Offline'));
      if (mode === 'repeated') port.call.mockResolvedValue({ records: [record(2, 'assistant', 'End')], hasMore: true });
      if (mode === 'identity') port.home = '/other';
      if (mode === 'future') port.call.mockResolvedValue({ records: [record(3, 'assistant', 'Newer')], hasMore: false });
      const service = new DshHistoryService(async () => port as DshHistoryReader);
      const conv = conversation();
      conv.messages = [{ id: 'saved', role: 'assistant', content: 'Saved', timestamp: 1 }];
      await expect(service.hydrateConversationHistory(conv, '/vault')).rejects.toThrow();
      expect(conv.messages[0].content).toBe('Saved');
      expect(conv.sessionId).toBe('native');
      expect(await service.resolveMissingConversationSession(conv, '/vault')).toBe('preserve');
    }
  });

  it('rejects a snapshot from a stale source session without replacing saved messages', async () => {
    const port = reader();
    port.snapshot.mockResolvedValue({ cursor: 0, records: [record(0, 'user', 'Wrong source')], hasMore: false, header: { id: 'stale' } });
    const service = new DshHistoryService(async () => port as DshHistoryReader);
    const conv = conversation();
    conv.messages = [{ id: 'saved', role: 'user', content: 'Saved', timestamp: 1 }];
    await expect(service.hydrateConversationHistory(conv, '/vault')).rejects.toThrow(/different native session/);
    expect(conv.messages[0].content).toBe('Saved');
    expect(port.call).not.toHaveBeenCalled();
  });

  it('compares Windows homes without case or separator differences', async () => {
    const port = reader();
    port.home = 'C:\\Users\\Name\\.dsh';
    port.snapshot.mockResolvedValue({ cursor: -1, records: [], hasMore: false, header: { id: 'native' } });
    const conv = conversation();
    conv.providerState = { ...conv.providerState, home: 'c:/users/name/.dsh/' };
    const service = new DshHistoryService(async () => port as DshHistoryReader);
    await service.hydrateConversationHistory(conv, '/vault');
    expect(port.snapshot).toHaveBeenCalledWith('native');
  });

  it('discards an in-flight native result when the conversation switches sessions', async () => {
    const port = reader();
    const conv = conversation();
    port.call.mockImplementation(async () => {
      conv.sessionId = 'new-session';
      conv.messages = [{ id: 'new', role: 'user', content: 'New session', timestamp: 1 }];
      return { records: [record(0, 'user', 'Old'), record(1, 'assistant', 'Old')], hasMore: false };
    });
    const service = new DshHistoryService(async () => port as DshHistoryReader);
    await expect(service.hydrateConversationHistory(conv, '/vault')).rejects.toThrow(/changed/);
    expect(conv.messages[0].content).toBe('New session');
    expect(conv.sessionId).toBe('new-session');
  });

  it('keeps the opening watermark unchanged across multiple backwards pages', async () => {
    const port = reader();
    port.snapshot.mockResolvedValue({ cursor: 4, records: [record(4, 'assistant', 'Last')], hasMore: true });
    port.call.mockResolvedValueOnce({ records: [record(2, 'user', 'Second'), record(3, 'assistant', 'Reply')], hasMore: true })
      .mockResolvedValueOnce({ records: [record(0, 'user', 'First'), record(1, 'assistant', 'Reply')], hasMore: false });
    const conv = conversation();
    await new DshHistoryService(async () => port as DshHistoryReader).hydrateConversationHistory(conv, '/vault');
    expect(port.call.mock.calls).toEqual([
      ['session/page', { request: { address: { kind: 'session', sessionId: 'native' }, throughSeq: 4, beforeSeq: 4, maxMessages: 100 } }],
      ['session/page', { request: { address: { kind: 'session', sessionId: 'native' }, throughSeq: 4, beforeSeq: 2, maxMessages: 100 } }],
    ]);
    expect(conv.messages).toHaveLength(5);
  });

  it('reads availability using the generated Remote request parameter envelope', async () => {
    const port = reader();
    port.call.mockResolvedValue({ asOfSeq: 2, values: {} });
    const service = new DshHistoryService(async () => port as DshHistoryReader);
    expect(await service.getConversationSessionAvailability(conversation(), '/vault')).toBe('available');
    expect(port.call).toHaveBeenCalledWith('session/projections', { request: { sessionId: 'native' } });
  });
});
