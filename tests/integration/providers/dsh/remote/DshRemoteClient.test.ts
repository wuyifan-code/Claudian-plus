import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { WebSocketServer } from 'ws';

import { DshRemoteClient } from '@/providers/dsh/remote/DshRemoteClient';

describe('DSH official Remote wire protocol', () => {
  test('authenticates native HTTP/mux, correlates RPC and cancels streams without replay', async () => {
    const requests: unknown[] = [];
    const frames: Record<string, unknown>[] = [];
    const cookies: (string | undefined)[] = [];
    let pongReceived: Promise<void>;
    const server = createServer((request, response) => {
      cookies.push(request.headers.cookie);
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        requests.push({ url: request.url, body });
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: body.method === 'failure' ? { ok: false, error: { code: 'gateway/bad-request', message: 'session=secret', details: {} } } : { ok: true, value: { id: 'agent-1' } } }));
      });
    });
    const sockets = new WebSocketServer({ server, path: '/api/remote.mux' });
    sockets.on('connection', (socket, request) => {
      cookies.push(request.headers.cookie);
      pongReceived = new Promise(resolve => socket.once('pong', () => resolve()));
      socket.ping();
      socket.on('message', raw => {
        const frame = JSON.parse(raw.toString());
        frames.push(frame);
        if (frame.type === 'open') socket.send(JSON.stringify({ type: 'item', streamId: frame.streamId, value: { type: 'ready' } }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new DshRemoteClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'session=secret');
    try {
      await client.connect();
      await expect(client.call('session/create', { name: 'test' }, { agent: 'agent-1' })).resolves.toEqual({ id: 'agent-1' });
      expect(requests[0]).toEqual({ url: '/api/session/create', body: { type: 'client-request', rpcId: expect.any(String), method: 'session/create', payload: { args: { name: 'test' }, lookup: { agent: 'agent-1' } } } });
      await expect(client.call('failure')).rejects.toMatchObject({ code: 'gateway/bad-request' });
      await expect(client.call('failure')).rejects.not.toThrow('secret');
      const onError = jest.fn();
      let unsubscribe = () => {};
      const value = await new Promise<unknown>(resolve => { unsubscribe = client.subscribe('$events', { args: {} }, resolve, onError); });
      expect(value).toEqual({ type: 'ready' });
      unsubscribe();
      await new Promise<void>(resolve => {
        const socket = [...sockets.clients][0];
        socket.once('message', () => resolve());
      });
      expect(frames).toEqual([{ type: 'open', streamId: expect.any(String), endpoint: '$events', payload: { args: {} } }, { type: 'cancel', streamId: frames[0].streamId }]);
      await pongReceived!;
      expect(cookies.every(cookie => cookie === 'session=secret')).toBe(true);
      const disconnected = new Promise<void>(resolve => client.onDisconnect(resolve));
      [...sockets.clients][0].terminate();
      await disconnected;
      expect(onError).not.toHaveBeenCalled();
    } finally {
      client.dispose();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => server.close(() => resolve())));
    }
  });
});
