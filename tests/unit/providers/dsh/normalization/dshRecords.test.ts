import { DshStreamNormalizer, mapDshRecordsToMessages } from '@/providers/dsh/normalization/dshRecords';

const record = (seq: number, type: string, data: unknown) => ({
  type: 'event', event: { seq, time: 100 + seq, type, data, surfaceOp: 'append' },
});
const message = (id: string, role: string, content: unknown[], source = { kind: role === 'assistant' ? 'model' : 'user' }) => ({ id, role, content, source });

describe('DSH official record normalization', () => {
  it('projects committed messages, coalesces fragments and preserves tool order without retry duplication', () => {
    const committed = record(3, 'assistant/message', {
      turn: 1, step: 1, stream: [], message: message('a', 'assistant', [
        { type: 'reasoning', text: 'Think' }, { type: 'reasoning', text: ' more' },
        { type: 'text', text: 'Hello' }, { type: 'text', text: ' world' },
        { type: 'tool-call', id: 't', name: 'fs_read', arguments: '{"path":"a"}' },
        { type: 'text', text: 'After' },
      ]),
    });
    const messages = mapDshRecordsToMessages([
      record(0, 'user/message', message('u', 'user', [{ type: 'text', text: 'Hi' }])),
      record(1, 'user/message', message('internal', 'user', [{ type: 'text', text: 'secret context' }], { kind: 'instructions' })),
      record(2, 'assistant/attempt', { stream: [{ type: 'text-chunks', texts: ['discarded'] }] }),
      committed, committed,
      record(4, 'tool/call', { callId: 't', name: 'fs_read', arguments: '{"path":"a"}' }),
      record(5, 'tool/result', { message: { ...message('r', 'tool', [{ type: 'text', text: 'File' }]), toolCallId: 't', isError: false } }),
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe('Hello worldAfter');
    expect(messages[1].contentBlocks).toEqual([
      { type: 'thinking', content: 'Think more' }, { type: 'text', content: 'Hello world' },
      { type: 'tool_use', toolId: 't' }, { type: 'text', content: 'After' },
    ]);
    expect(messages[1].toolCalls).toEqual([{ id: 't', name: 'fs_read', input: { path: 'a' }, status: 'completed', result: 'File' }]);
  });

  it('does not expose replacement context and refuses unrecognized required events', () => {
    expect(mapDshRecordsToMessages([{ ...record(0, 'user/message', message('u', 'user', [{ type: 'text', text: 'summary' }])), event: {
      ...record(0, 'user/message', message('u', 'user', [{ type: 'text', text: 'summary' }])).event,
      surfaceOp: { op: 'replace', startSeq: 0, endSeq: 0 },
    } }])).toEqual([]);
    expect(() => mapDshRecordsToMessages([record(0, 'future/required', {})])).toThrow(/Unsupported/);
    expect(mapDshRecordsToMessages([{ type: 'event', event: { ...record(0, 'future/info', {}).event, ignorable: true } }])).toEqual([]);
    expect(mapDshRecordsToMessages([{ type: 'event', event: { ...record(0, 'future/info', null).event, ignorable: true } }])).toEqual([]);
  });

  it('emits live deltas once, handles complete blocks, and suppresses committed duplicates', () => {
    const normalizer = new DshStreamNormalizer();
    const frame = (value: unknown) => ({ type: 'assistant-stream', frame: value });
    expect(normalizer.accept(frame({ type: 'start', attemptId: 'a', revision: 1, startedAfterSeq: 0, turn: 1, step: 1 }))).toEqual([]);
    const delta = frame({ type: 'chunk', attemptId: 'a', revision: 2, index: 0, time: 2, chunk: { type: 'text-delta', index: 0, text: 'Hi' } });
    expect(normalizer.accept(delta)).toEqual([{ type: 'text', content: 'Hi' }]);
    expect(normalizer.accept(delta)).toEqual([]);
    expect(normalizer.accept(frame({ type: 'chunk', attemptId: 'a', revision: 3, index: 1, time: 3, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'Hi' } } }))).toEqual([]);
    expect(normalizer.accept(record(1, 'assistant/message', { turn: 1, step: 1, stream: [], message: message('m', 'assistant', [{ type: 'text', text: 'Hi' }]) }))).toEqual([]);
    expect(normalizer.accept(record(2, 'tool/call', { callId: 't', name: 'shell', arguments: 'bad json' }))).toEqual([{ type: 'tool_use', id: 't', name: 'shell', input: { rawArguments: 'bad json' } }]);
    expect(normalizer.accept(record(3, 'tool/result', { message: { ...message('r', 'tool', [{ type: 'text', text: 'Oops' }]), toolCallId: 't', isError: true } }))).toEqual([{ type: 'tool_result', id: 't', content: 'Oops', isError: true }]);
  });

  it('fails closed when streamed text is discarded by a retry and recovers only committed history', () => {
    const normalizer = new DshStreamNormalizer();
    normalizer.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'first', turn: 1, step: 1 } });
    expect(normalizer.accept({ type: 'assistant-stream', frame: {
      type: 'chunk', attemptId: 'first', index: 0, chunk: { type: 'text-delta', index: 0, text: 'Discard me' },
    } })).toEqual([{ type: 'text', content: 'Discard me' }]);
    expect(normalizer.accept({ type: 'assistant-stream', frame: {
      type: 'end', attemptId: 'first', outcome: { kind: 'committed', eventType: 'assistant/attempt', seq: 0 },
    } })[0]).toMatchObject({ type: 'error' });
    expect(normalizer.invalidated).toBe(true);
    const committed = record(1, 'assistant/message', { turn: 1, step: 1, message: message('final', 'assistant', [{ type: 'text', text: 'Use me' }]), stream: [] });
    expect(normalizer.accept(committed)).toEqual([]);
    expect(mapDshRecordsToMessages([
      record(0, 'assistant/attempt', { stream: [{ type: 'text-chunks', texts: ['Discard me'] }] }), committed,
    ]).map(item => item.content)).toEqual(['Use me']);
  });

  it('tracks the official rpcId on user source and the enclosing turn', () => {
    const normalizer = new DshStreamNormalizer();
    normalizer.accept(record(0, 'turn/start', { turn: 4 }));
    normalizer.accept(record(1, 'user/message', { ...message('u', 'user', []), source: { kind: 'user', rpcId: 'request' } }));
    expect(normalizer.latestRequestId).toBe('request');
    expect(normalizer.activeTurn).toBe(4);
    normalizer.accept(record(2, 'turn/end', { turn: 4, reason: { kind: 'completed' } }));
    expect(normalizer.endedTurn).toBe(4);
  });

  it('surfaces a durable terminal failure without replaying historical snapshot messages', () => {
    const normalizer = new DshStreamNormalizer();
    expect(normalizer.accept({ type: 'snapshot', cursor: 4, records: [record(4, 'assistant/message', {
      message: message('old', 'assistant', [{ type: 'text', text: 'Already displayed' }]),
    })] })).toEqual([]);
    expect(normalizer.accept(record(4, 'assistant/message', {
      message: message('old', 'assistant', [{ type: 'text', text: 'Already displayed' }]),
    }))).toEqual([]);
    expect(normalizer.accept(record(5, 'turn/end', { turn: 3, reason: { kind: 'error', error: { message: 'Native failure', code: 'UNKNOWN' } } })))
      .toEqual([{ type: 'error', content: 'Native failure' }]);
    expect(normalizer.endedTurn).toBe(3);
  });

  it('fails closed if a committed message omits a previously streamed block', () => {
    const normalizer = new DshStreamNormalizer();
    normalizer.accept({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'first', turn: 1, step: 1 } });
    normalizer.accept({ type: 'assistant-stream', frame: {
      type: 'chunk', attemptId: 'first', index: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'Old thinking' },
    } });
    expect(normalizer.accept(record(0, 'assistant/message', { turn: 1, step: 1, message: message('final', 'assistant', []) }))[0]).toMatchObject({ type: 'error' });
    expect(normalizer.invalidated).toBe(true);
  });
});
