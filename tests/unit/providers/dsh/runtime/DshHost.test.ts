import { DshHost, type DshNativeConnection } from '@/providers/dsh/runtime/DshHost';

function peer() {
  let receive: (value: unknown) => void = () => {};
  let disconnect = () => {};
  const client = {
    connect: jest.fn(async () => {}),
    onDisconnect: jest.fn((listener: () => void) => { disconnect = listener; return jest.fn(); }),
    subscribe: jest.fn((_method: string, _args: unknown, listener: (value: unknown) => void) => {
      receive = listener;
      queueMicrotask(() => listener({ type: 'ready', clientId: 'client', host: { home: '/home' } }));
      return jest.fn();
    }),
    call: jest.fn(async () => {}),
  };
  return { client, send: (frame: unknown) => receive(frame), disconnect: () => disconnect() };
}

describe('workspace native DSH Host', () => {
  it('refuses cached leases after the provider configuration is changed', async () => {
    const p = peer();
    let valid = true;
    const host = new DshHost(async () => ({ client: p.client, home: '/home', dispose: async () => {} } as unknown as DshNativeConnection), 10000,
      () => { if (!valid) throw new Error('configuration changed'); });
    const lease = await host.acquire();
    valid = false;
    await expect(lease.ready()).rejects.toThrow('configuration');
    await expect(host.acquire()).rejects.toThrow('configuration');
    lease.release(); await host.dispose();
  });
  it('shares one native process, prevents duplicate session ownership and releases idempotently', async () => {
    const dispose = jest.fn(async () => {});
    const connection = { client: peer().client, home: '/native/home', dispose } as unknown as DshNativeConnection;
    const start = jest.fn(async () => connection);
    const host = new DshHost(start, 10000);
    const [a, b] = await Promise.all([host.acquire(), host.acquire()]);
    expect(start).toHaveBeenCalledTimes(1);
    a.claim('one'); b.claim('two');
    expect(() => b.claim('one')).toThrow('already');
    a.release(); a.release();
    expect(dispose).not.toHaveBeenCalled();
    b.release();
    await host.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes a late startup instead of publishing it after teardown', async () => {
    let finish!: (value: DshNativeConnection) => void;
    const dispose = jest.fn(async () => {});
    const host = new DshHost(() => new Promise(resolve => { finish = resolve; }), 1000);
    const acquiring = host.acquire();
    const rejected = acquiring.catch((error: Error) => error);
    const stopping = host.dispose();
    finish({ client: peer().client, home: '/home', dispose } as unknown as DshNativeConnection);
    expect(await rejected).toHaveProperty('message', expect.stringContaining('disposed'));
    await stopping;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('routes approvals only to the owning lease and never replays a result after disconnect', async () => {
    const p = peer();
    const host = new DshHost(async () => ({ client: p.client, home: '/home', dispose: async () => {} } as unknown as DshNativeConnection));
    const lease = await host.acquire();
    let finish!: (value: { kind: 'result'; value: string }) => void;
    const handler = jest.fn((_event: { signal: AbortSignal }) => new Promise<{ kind: 'result'; value: string }>(resolve => { finish = resolve; }));
    lease.claim('one', handler);
    p.send({ type: 'waterfall', eventId: 'e1', agentId: 'one', event: 'user/approval', request: {} });
    expect(handler).toHaveBeenCalledTimes(1);
    p.disconnect();
    expect(handler.mock.calls[0][0].signal.aborted).toBe(true);
    finish({ kind: 'result', value: 'allowed-once' });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(p.client.call).not.toHaveBeenCalled();
    await lease.ready();
    p.send({ type: 'waterfall', eventId: 'e2', agentId: 'unowned', event: 'user/approval', request: {} });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(p.client.call).toHaveBeenCalledWith('$events/result', { clientId: 'client', eventId: 'e2', outcome: { kind: 'next' } });
    lease.release();
    await host.dispose();
  });

  it('withdraws a pending interaction when its owning tab releases the lease', async () => {
    const p = peer();
    const host = new DshHost(async () => ({ client: p.client, home: '/home', dispose: async () => {} } as unknown as DshNativeConnection));
    const lease = await host.acquire();
    let signal: AbortSignal | undefined;
    lease.claim('one', event => new Promise(resolve => {
      signal = event.signal;
      event.signal.addEventListener('abort', () => resolve({ kind: 'result', value: 'allowed-once' }), { once: true });
    }));
    p.send({ type: 'waterfall', eventId: 'pending', agentId: 'one', event: 'approval/request', request: {} });
    lease.release();
    expect(signal?.aborted).toBe(true);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(p.client.call).toHaveBeenCalledTimes(1);
    expect(p.client.call).toHaveBeenCalledWith('$events/result', { clientId: 'client', eventId: 'pending', outcome: { kind: 'next' } });
    await host.dispose();
  });

  it('waits for an idle process to finish shutting down before launching its replacement', async () => {
    let finish!: () => void;
    const stopping = new Promise<void>(resolve => { finish = resolve; });
    const start = jest.fn(async () => ({ client: peer().client, home: '/home', dispose: () => stopping } as unknown as DshNativeConnection));
    const host = new DshHost(start, 5);
    const first = await host.acquire(); first.release();
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    const acquiring = host.acquire();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(start).toHaveBeenCalledTimes(1);
    finish();
    const second = await acquiring;
    expect(start).toHaveBeenCalledTimes(2);
    second.release(); await host.dispose();
  });

  it('closes an event stream that never becomes ready before allowing another acquisition', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'setImmediate'] });
    const p = peer();
    const unsubscribe = jest.fn();
    p.client.subscribe.mockImplementationOnce(() => unsubscribe);
    const host = new DshHost(async () => ({ client: p.client, home: '/home', dispose: async () => {} } as unknown as DshNativeConnection));
    try {
      const acquiring = host.acquire().catch((error: Error) => error);
      await jest.advanceTimersByTimeAsync(15001);
      expect(await acquiring).toHaveProperty('message', expect.stringContaining('timed out'));
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      const lease = await host.acquire();
      lease.release();
    } finally { await host.dispose(); jest.useRealTimers(); }
  });
});
