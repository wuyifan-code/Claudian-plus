import { createDshHistoryReader } from '@/providers/dsh/history/createDshHistoryReader';
import type { DshHost } from '@/providers/dsh/runtime/DshHost';

function fixture() {
  const unsubscribe = jest.fn();
  let onValue: (value: unknown) => void = () => {};
  let onError: (error: Error) => void = () => {};
  const client = {
    call: jest.fn().mockResolvedValue({ records: [], hasMore: false }),
    subscribe: jest.fn((_endpoint: string, _payload: unknown, value: (value: unknown) => void, error: (error: Error) => void) => {
      onValue = value; onError = error; return unsubscribe;
    }),
  };
  const leases: Array<{ home: string; client: typeof client; ready: jest.Mock; release: jest.Mock }> = [];
  const host = { acquire: jest.fn(async () => {
    const lease = { home: '/native', client, ready: jest.fn(async () => {}), release: jest.fn() };
    leases.push(lease); return lease;
  }) };
  return { host: host as unknown as DshHost, acquire: host.acquire, client, leases, unsubscribe,
    emit: (value: unknown) => onValue(value), fail: (error: Error) => onError(error) };
}

describe('transient DSH history reader', () => {
  it('uses short-lived leases for identity, cold calls and snapshot subscriptions', async () => {
    const setup = fixture();
    const reader = await createDshHistoryReader(setup.host);
    expect(reader.home).toBe('/native');
    expect(reader.preset).toBe('claudian-plus');
    expect(setup.leases[0].release).toHaveBeenCalledTimes(1);
    await reader.call('session/page', { request: { throughSeq: -1 } });
    expect(setup.leases[1].release).toHaveBeenCalledTimes(1);
    const snapshot = reader.snapshot('session');
    await new Promise(resolve => setImmediate(resolve));
    expect(setup.client.subscribe).toHaveBeenCalledWith('session/follow', { args: { request: {
      address: { kind: 'session', sessionId: 'session' }, maxMessages: 100,
    } } }, expect.any(Function), expect.any(Function), undefined, expect.any(Function));
    setup.emit({ type: 'snapshot', cursor: -1, records: [], hasMore: false, header: { id: 'session' } });
    await expect(snapshot).resolves.toMatchObject({ cursor: -1, records: [], hasMore: false });
    expect(setup.unsubscribe).toHaveBeenCalledTimes(1);
    expect(setup.leases[2].release).toHaveBeenCalledTimes(1);
    expect(setup.client.call.mock.calls.every(call => call[0] !== 'session/cancel')).toBe(true);
  });

  it('releases subscriptions and leases on abort, native failure and malformed opening', async () => {
    for (const kind of ['abort', 'error', 'malformed']) {
      const setup = fixture();
      const reader = await createDshHistoryReader(setup.host);
      const controller = new AbortController();
      const snapshot = reader.snapshot('session', controller.signal);
      const rejected = snapshot.catch((error: Error) => error);
      await new Promise(resolve => setImmediate(resolve));
      if (kind === 'abort') controller.abort();
      if (kind === 'error') setup.fail(new Error('Disconnected'));
      if (kind === 'malformed') setup.emit({ type: 'snapshot', cursor: 'wrong', records: [], hasMore: false });
      expect(await rejected).toBeInstanceOf(Error);
      expect(setup.unsubscribe).toHaveBeenCalledTimes(1);
      expect(setup.leases[1].release).toHaveBeenCalledTimes(1);
      expect(setup.client.call).not.toHaveBeenCalled();
    }
  });

  it('times out an unopened snapshot and releases its subscription', async () => {
    const setup = fixture();
    const reader = await createDshHistoryReader(setup.host, { timeoutMs: 20 });
    await expect(reader.snapshot('session')).rejects.toThrow(/timed out/i);
    expect(setup.unsubscribe).toHaveBeenCalledTimes(1);
    expect(setup.leases[1].release).toHaveBeenCalledTimes(1);
  });
});
