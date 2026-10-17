import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { WebSocketServer } from 'ws';

import { DshRemoteClient } from '@/providers/dsh/remote/DshRemoteClient';

describe('DshRemoteClient HTTP lifecycle', () => {
  test('validates loopback origin and prevents credential forwarding', () => {
    expect(() => new DshRemoteClient('https://example.com', 'secret')).toThrow('loopback');
    expect(() => new DshRemoteClient('http://secret@127.0.0.1:1', 'cookie')).toThrow('loopback');
  });

  test('rejects a mismatched response correlation without leaking server data', async () => {
    const server = createServer((request, response) => {
      request.resume();
      response.end(JSON.stringify({ type: 'server-response', rpcId: 'wrong', result: { ok: true, value: 'private' } }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new DshRemoteClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'session=secret');
    try {
      await expect(client.call('session/list')).rejects.toThrow('Invalid DSH Remote response');
    } finally {
      client.dispose();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test('bounds HTTP responses, times out and honours cancellation', async () => {
    const server = createServer((request, response) => {
      request.resume();
      if (request.url?.includes('large')) response.end('x'.repeat(200));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new DshRemoteClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'session=secret', { requestTimeoutMs: 30, maxResponseBytes: 100 });
    try {
      await expect(client.call('large')).rejects.toThrow('limit');
      await expect(client.call('wait')).rejects.toThrow('timed out');
      const controller = new AbortController();
      const cancelled = client.call('wait', {}, undefined, controller.signal);
      controller.abort('session=secret');
      await expect(cancelled).rejects.toThrow('cancelled');
      const pending = client.call('wait');
      client.dispose();
      await expect(pending).rejects.toThrow('disposed');
      await expect(client.call('wait')).rejects.toThrow('disposed');
    } finally {
      client.dispose();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test('fails a malformed identifiable frame only on its logical stream', async () => {
    const server = createServer();
    const sockets = new WebSocketServer({ server, path: '/api/remote.mux' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new DshRemoteClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'session=secret');
    try {
      const opened: Record<string, unknown>[] = [];
      sockets.on('connection', socket => socket.on('message', raw => {
        const frame = JSON.parse(raw.toString());
        if (frame.type !== 'open') return;
        opened.push(frame);
        if (opened.length === 2) {
          socket.send(JSON.stringify({ type: 'item', streamId: opened[0].streamId, unexpected: true }));
          socket.send(JSON.stringify({ type: 'item', streamId: opened[1].streamId, value: 'healthy' }));
        }
      }));
      await client.connect();
      const failed = jest.fn();
      client.subscribe('session/follow', { args: {} }, jest.fn(), failed);
      const value = await new Promise<unknown>(resolve => client.subscribe('session/follow', { args: {} }, resolve, jest.fn()));
      expect(value).toBe('healthy');
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid DSH Remote stream frame' }));
    } finally {
      client.dispose();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => server.close(() => resolve())));
    }
  });

  test('settles streams and HTTP calls when the physical carrier closes', async () => {
    let admitted!: () => void;
    const requestAdmitted = new Promise<void>(resolve => { admitted = resolve; });
    const server = createServer(request => { request.resume(); admitted(); });
    const sockets = new WebSocketServer({ server, path: '/api/remote.mux' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new DshRemoteClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'session=secret');
    try {
      await client.connect();
      const streamFailed = jest.fn();
      client.subscribe('$events', { args: {} }, jest.fn(), streamFailed);
      const pending = client.call('wait');
      const rejected = pending.catch((error: Error) => error);
      await requestAdmitted;
      const disconnected = jest.fn();
      client.onDisconnect(disconnected);
      [...sockets.clients][0].terminate();
      expect(await rejected).toHaveProperty('message', expect.stringContaining('closed'));
      expect(streamFailed).toHaveBeenCalledTimes(1);
      expect(disconnected).toHaveBeenCalledTimes(1);
    } finally {
      client.dispose();
      for (const socket of sockets.clients) socket.terminate();
      server.closeAllConnections();
      await new Promise<void>(resolve => sockets.close(() => server.close(() => resolve())));
    }
  });

  test('supports cancellation of a caller joining a pending connection', async () => {
    const server = createServer();
    server.on('upgrade', () => {});
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new DshRemoteClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'session=secret');
    const first = client.connect();
    const firstRejected = first.catch((error: Error) => error);
    try {
      const controller = new AbortController();
      const second = client.connect(controller.signal);
      const secondRejected = second.catch((error: Error) => error);
      controller.abort();
      expect(await secondRejected).toHaveProperty('message', expect.stringContaining('cancelled'));
    } finally {
      client.dispose();
      expect(await firstRejected).toHaveProperty('message', expect.stringContaining('disposed'));
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
