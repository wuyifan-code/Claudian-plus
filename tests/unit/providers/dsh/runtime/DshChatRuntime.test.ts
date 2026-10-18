import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { StreamChunk } from '@/core/types';
import { encodeDshModelId } from '@/providers/dsh/models';
import { DshChatRuntime } from '@/providers/dsh/runtime/DshChatRuntime';
import type { DshHost } from '@/providers/dsh/runtime/DshHost';

function fixture() {
  let receive: (value: unknown) => void = () => {};
  let fail: (error: Error) => void = () => {};
  let disconnect: () => void = () => {};
  let interaction: (request: any) => Promise<any> = async () => ({ kind: 'next' });
  let seq = 0;
  const event = (type: string, data: unknown) => receive({ type: 'event', event: { type, seq: ++seq, time: 1, data } });
  const client = {
    call: jest.fn(async (method: string, args: any) => {
      if (method === 'session/create') return { sessionId: 'session-1', agentPreset: 'claudian-plus' };
      return { accepted: true };
    }),
    subscribe: jest.fn((_endpoint: string, _payload: unknown, onValue: (value: unknown) => void, onError: (error: Error) => void) => {
      receive = onValue;
      fail = onError;
      queueMicrotask(() => receive({ type: 'snapshot', header: { id: 'session-1' }, cursor: 0, records: [], hasMore: false }));
      return jest.fn();
    }),
    onDisconnect: jest.fn((listener: () => void) => { disconnect = listener; return jest.fn(); }),
  };
  const lease = { client, home: 'C:\\DSH', ready: jest.fn(async () => {}), claim: jest.fn((_id: string, handler: typeof interaction) => { interaction = handler; }), release: jest.fn() };
  const host = { acquire: jest.fn(async () => lease) };
  const plugin = { app: {}, settings: { model: 'dsh/default', permissionMode: 'normal', providerConfigs: { dsh: { enabled: true, models: [] } } } as Record<string, unknown>, getMemoryInjectionText: jest.fn(async () => null), getConsciousnessInjectionText: jest.fn(async () => null) };
  const runtime = new DshChatRuntime(plugin as unknown as ProviderHost, host as unknown as DshHost, () => 'C:\\Vault');
  const collect = async () => {
    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'hello' }))) chunks.push(chunk);
    return chunks;
  };
  const untilPrompt = async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const call = client.call.mock.calls.find(([method]) => method === 'session/prompt');
      if (call) return call[1].request.requestId as string;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    throw new Error('Prompt was not submitted');
  };
  return { runtime, plugin, client, lease, host, collect, untilPrompt, event, receive: (value: unknown) => receive(value), fail: (error: Error) => fail(error), disconnect: () => disconnect(), interaction: (request: any) => interaction(request) };
}

describe('DshChatRuntime native lifecycle', () => {
  test('follows before prompting and completes only the correlated durable turn', async () => {
    const f = fixture();
    const result = f.collect();
    const requestId = await f.untilPrompt();
    expect(f.client.subscribe).toHaveBeenCalledWith('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'session-1' }, assistantStream: true, maxMessages: 50 } } }, expect.any(Function), expect.any(Function), undefined, expect.any(Function));
    expect(f.client.call.mock.calls[0]).toEqual(['session/create', { request: { cwd: 'C:\\Vault', agentPreset: 'claudian-plus' } }]);
    expect(f.runtime.consumeTurnMetadata()).toEqual({ wasSent: false });
    f.event('turn/start', { turn: 1 });
    f.event('turn/end', { turn: 1, reason: { kind: 'completed' } });
    f.event('turn/start', { turn: 2 });
    f.event('user/message', { id: 'user-2', source: { kind: 'user', rpcId: requestId }, content: [] });
    f.event('assistant/message', { turn: 2, step: 1, message: { id: 'assistant-2', role: 'assistant', content: [{ type: 'text', text: 'answer' }] } });
    f.event('turn/end', { turn: 2, reason: { kind: 'completed' } });
    expect(await result).toEqual([{ type: 'text', content: 'answer' }, { type: 'done' }]);
    expect(f.runtime.consumeTurnMetadata()).toEqual({ wasSent: true, userMessageId: 'user-2', assistantMessageId: 'assistant-2' });
    expect(f.runtime.buildSessionUpdates({ conversation: null, sessionInvalidated: false }).updates).toEqual({ sessionId: 'session-1', providerState: { schemaVersion: 1, backend: 'native', home: 'C:\\DSH', preset: 'claudian-plus' } });
    f.runtime.cleanup();
  });

  test('preserves legacy and mismatched native state without creating replacement sessions', async () => {
    const f = fixture();
    f.runtime.syncConversationState({ sessionId: 'legacy', providerState: { sessionId: 'legacy' } });
    expect(await f.collect()).toEqual([expect.objectContaining({ type: 'error', content: expect.stringMatching(/legacy|ACP/i) }), { type: 'done' }]);
    expect(f.host.acquire).not.toHaveBeenCalled();
    f.runtime.syncConversationState({ sessionId: 'native', providerState: { schemaVersion: 1, backend: 'native', home: 'C:\\Other' } });
    expect(await f.collect()).toEqual([expect.objectContaining({ type: 'error', content: expect.stringContaining('home') }), { type: 'done' }]);
    expect(f.runtime.getSessionId()).toBe('native');
    expect(f.client.call).not.toHaveBeenCalled();
    f.runtime.cleanup();
  });

  test('carrier loss does not cancel or replay native work and leaves explicit Stop available', async () => {
    const f = fixture();
    const result = f.collect();
    await f.untilPrompt();
    f.disconnect();
    expect(await result).toEqual([expect.objectContaining({ type: 'error' }), { type: 'done' }]);
    expect(f.client.call.mock.calls.filter(([method]) => method === 'session/cancel')).toHaveLength(0);
    expect(f.lease.release).not.toHaveBeenCalled();
    f.runtime.cancel();
    expect(f.client.call).toHaveBeenCalledWith('session/cancel', { request: { sessionId: 'session-1' } });
    expect(f.client.call.mock.calls.filter(([method]) => method === 'session/prompt')).toHaveLength(1);
    f.runtime.cleanup();
  });

  test('validates catalog model and reasoning before submission', async () => {
    const f = fixture();
    const selected = encodeDshModelId('provider', 'model');
    Object.assign(f.plugin.settings, { model: selected, effortLevel: 'wrong' });
    Object.assign((f.plugin.settings.providerConfigs as Record<string, Record<string, unknown>>).dsh, { models: [{ provider: 'provider', model: 'model', label: 'Model', reasoning: ['high'] }] });
    expect(await f.collect()).toEqual([expect.objectContaining({ type: 'error', content: expect.stringContaining('reasoning') }), { type: 'done' }]);
    expect(f.client.call.mock.calls.filter(([method]) => method === 'session/prompt')).toHaveLength(0);
    Object.assign(f.plugin.settings, { effortLevel: 'high' });
    const result = f.collect();
    await f.untilPrompt();
    expect(f.client.call).toHaveBeenCalledWith('session/selectModel', { request: { sessionId: 'session-1', provider: 'provider', model: 'model', reasoningEffort: 'high' } });
    f.fail(new Error('closed'));
    await result;
    f.runtime.cleanup();
  });

  test('maps approval once and denies dismissals or aborted requests', async () => {
    const f = fixture();
    const result = f.collect();
    await f.untilPrompt();
    const approval = jest.fn(async () => 'allow' as const);
    f.runtime.setApprovalCallback(approval);
    const controller = new AbortController();
    const request = { event: 'approval/request', request: { toolName: 'shell', reason: 'Run command', callId: 'call-1' }, signal: controller.signal };
    expect(await f.interaction(request)).toEqual({ kind: 'result', value: 'allowed-once' });
    controller.abort();
    expect(await f.interaction(request)).toEqual({ kind: 'result', value: 'rejected' });
    f.runtime.setApprovalCallback(async () => 'cancel');    expect(await f.interaction({ ...request, signal: new AbortController().signal })).toEqual({ kind: 'result', value: 'rejected' });
    f.runtime.cancel();
    expect(await result).toEqual([{ type: 'done' }]);
    f.runtime.cleanup();
  });

  test('YOLO mode auto-approves without consulting the approval UI', async () => {
    const f = fixture();
    f.plugin.settings.permissionMode = 'yolo';
    const result = f.collect();
    await f.untilPrompt();
    const approval = jest.fn(async () => 'allow' as const);
    f.runtime.setApprovalCallback(approval);
    const outcome = await f.interaction({
      event: 'approval/request',
      request: { toolName: 'shell', reason: 'Run command', callId: 'call-1' },
      signal: new AbortController().signal,
    });
    expect(outcome).toEqual({ kind: 'result', value: 'allowed-once' });
    expect(approval).not.toHaveBeenCalled();
    f.runtime.cancel();
    await result;
    f.runtime.cleanup();
  });

  test('normal mode still routes approvals through the UI callback', async () => {
    const f = fixture();
    f.plugin.settings.permissionMode = 'normal';
    const result = f.collect();
    await f.untilPrompt();
    const approval = jest.fn(async () => 'allow' as const);
    f.runtime.setApprovalCallback(approval);
    expect(await f.interaction({
      event: 'approval/request',
      request: { toolName: 'shell' },
      signal: new AbortController().signal,
    })).toEqual({ kind: 'result', value: 'allowed-once' });
    expect(approval).toHaveBeenCalledTimes(1);
    f.runtime.cancel();
    await result;
    f.runtime.cleanup();
  });

  test('fails closed on native invalidation without cancelling the session', async () => {
    const f = fixture();
    const result = f.collect();
    await f.untilPrompt();
    f.receive({ type: 'invalidated', reason: 'snapshot replaced' });
    expect(await result).toEqual([expect.objectContaining({ type: 'error', content: expect.stringContaining('invalidated') }), { type: 'done' }]);
    expect(f.client.call.mock.calls.filter(([method]) => method === 'session/cancel')).toHaveLength(0);
    f.runtime.cleanup();
  });

  test('settles an aborted approval even when the UI callback remains pending', async () => {
    const f = fixture();
    const result = f.collect();
    await f.untilPrompt();
    f.runtime.setApprovalCallback(() => new Promise(() => {}));
    const dismiss = jest.fn();
    f.runtime.setApprovalDismisser(dismiss);
    const controller = new AbortController();
    const approval = f.interaction({ event: 'approval/request', request: { toolName: 'shell' }, signal: controller.signal });
    controller.abort();
    expect(await approval).toEqual({ kind: 'result', value: 'rejected' });
    expect(dismiss).toHaveBeenCalledTimes(1);
    f.runtime.cancel();
    await result;
    f.runtime.cleanup();
  });

  test('explicit cancellation during startup never submits a prompt', async () => {
    const f = fixture();
    let finish!: (value: typeof f.lease) => void;
    f.host.acquire.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = f.collect();
    f.runtime.cancel();
    finish(f.lease);
    expect(await result).toEqual([{ type: 'done' }]);
    expect(f.client.call.mock.calls.filter(([method]) => method === 'session/prompt')).toHaveLength(0);
    f.runtime.cleanup();
  });
});
