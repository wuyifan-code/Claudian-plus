import { randomUUID } from 'node:crypto';
import type { ClientRequest } from 'node:http';
import { request } from 'node:http';

import WebSocket from 'ws';

export interface DshRemoteClientOptions {
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxFrameBytes?: number;
}

type Stream = { onValue: (value: unknown) => void; onError: (error: Error) => void; onEnd?: () => void; cleanup?: () => void };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export class DshRemoteError extends Error {
  readonly code: string;

  constructor(code: string) {
    const safeCode = /^[a-z][a-z0-9/-]{0,100}$/.test(code) ? code : 'gateway/internal';
    super(`DSH Remote request failed (${safeCode})`);
    this.name = 'DshRemoteError';
    this.code = safeCode;
  }
}

/** Native DSH 0.2 Remote carrier. Domain consumers own recovery and replay. */
export class DshRemoteClient {
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxFrameBytes: number;
  private readonly requests = new Map<ClientRequest, (error: Error) => void>();
  private readonly streams = new Map<string, Stream>();
  private readonly disconnectListeners = new Set<() => void>();
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private cancelConnecting?: (error: Error) => void;
  private disposed = false;

  constructor(origin: string, private readonly cookie: string, options: DshRemoteClientOptions = {}) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('DSH Remote requires a loopback HTTP origin'); }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('DSH Remote requires a loopback HTTP origin');
    }
    if (!cookie || /[\r\n]/.test(cookie)) throw new Error('Invalid DSH Remote authentication');
    this.origin = url.origin;
    this.timeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 16 * 1024 * 1024;
    this.maxFrameBytes = options.maxFrameBytes ?? 16 * 1024 * 1024;
    for (const limit of [this.timeoutMs, this.maxResponseBytes, this.maxFrameBytes]) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid DSH Remote limits');
    }
  }

  connect(signal?: AbortSignal): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('DSH Remote client disposed'));
    if (signal?.aborted) return Promise.reject(new Error('DSH Remote connection cancelled'));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.waitForConnection(this.connecting, signal);
    const socket = new WebSocket(`${this.origin.replace('http:', 'ws:')}/api/remote.mux`, {
      headers: { Cookie: this.cookie },
      handshakeTimeout: this.timeoutMs,
      maxPayload: this.maxFrameBytes,
      perMessageDeflate: false,
      followRedirects: false,
      agent: false,
    });
    this.socket = socket;
    const connecting = new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        signal?.removeEventListener('abort', aborted);
        this.cancelConnecting = undefined;
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const aborted = () => {
        fail(new Error('DSH Remote connection cancelled'));
        socket.terminate();
      };
      this.cancelConnecting = fail;
      signal?.addEventListener('abort', aborted, { once: true });
      socket.once('open', () => { if (settled) return; settled = true; cleanup(); resolve(); });
      socket.on('message', (data, isBinary) => this.receive(data.toString(), isBinary));
      socket.on('error', () => {
        fail(new Error('DSH Remote connection failed'));
        this.lost(socket);
      });
      socket.once('close', () => {
        fail(new Error('DSH Remote connection closed'));
        this.lost(socket);
      });
    });
    this.connecting = connecting;
    void connecting.then(() => { if (this.connecting === connecting) this.connecting = undefined; },
      () => { if (this.connecting === connecting) this.connecting = undefined; });
    return connecting;
  }

  private waitForConnection(connecting: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return connecting;
    return new Promise<void>((resolve, reject) => {
      const aborted = () => reject(new Error('DSH Remote connection cancelled'));
      signal.addEventListener('abort', aborted, { once: true });
      void connecting.then(() => { signal.removeEventListener('abort', aborted); resolve(); },
        error => { signal.removeEventListener('abort', aborted); reject(error); });
    });
  }

  async call<T = unknown>(method: string, args: Record<string, unknown> = {}, lookup?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    if (this.disposed) throw new Error('DSH Remote client disposed');
    if (signal?.aborted) throw new Error('DSH Remote request cancelled');
    this.validateEndpoint(method);
    const rpcId = randomUUID();
    let body: string;
    try {
      body = JSON.stringify({ type: 'client-request', rpcId, method, payload: { args, ...(lookup === undefined ? {} : { lookup }) } });
    } catch { throw new Error('Invalid DSH Remote request payload'); }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        this.requests.delete(req);
        if (error) { reject(error); req.destroy(); } else resolve(value as T);
      };
      const aborted = () => finish(new Error('DSH Remote request cancelled'));
      const timer = window.setTimeout(() => finish(new Error('DSH Remote request timed out')), this.timeoutMs);
      const req = request(new URL(`/api/${method}`, this.origin), {
        method: 'POST', agent: false,
        headers: { Cookie: this.cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, response => {
        if (response.statusCode !== 200) {
          finish(new Error(`DSH Remote HTTP failure (${response.statusCode ?? 0})`));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > this.maxResponseBytes) { finish(new Error('DSH Remote response exceeds size limit')); return; }
          chunks.push(chunk);
        });
        response.on('error', () => finish(new Error('DSH Remote response interrupted')));
        response.on('end', () => {
          if (settled) return;
          try {
            const envelope: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId || !record(envelope.result)) {
              throw new Error('Invalid DSH Remote response');
            }
            const result = envelope.result;
            if (result.ok === true) finish(undefined, result.value as T);
            else if (result.ok === false && this.isFailure(result.error)) finish(new DshRemoteError(result.error.code));
            else throw new Error('Invalid DSH Remote response');
          } catch { finish(new Error('Invalid DSH Remote response')); }
        });
      });
      this.requests.set(req, error => finish(error));
      req.on('error', () => finish(new Error('DSH Remote request failed')));
      signal?.addEventListener('abort', aborted, { once: true });
      req.end(body);
    });
  }

  subscribe(endpoint: string, payload: unknown, onValue: (value: unknown) => void, onError: (error: Error) => void, signal?: AbortSignal, onEnd?: () => void): () => void {
    this.validateEndpoint(endpoint);
    if (this.disposed) throw new Error('DSH Remote client disposed');
    if (signal?.aborted) throw new Error('DSH Remote stream cancelled');
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('DSH Remote client disconnected');
    const streamId = randomUUID();
    let message: string;
    try { message = JSON.stringify({ type: 'open', streamId, endpoint, payload }); }
    catch { throw new Error('Invalid DSH Remote stream payload'); }
    const aborted = () => this.failStream(streamId, new Error('DSH Remote stream cancelled'));
    signal?.addEventListener('abort', aborted, { once: true });
    this.streams.set(streamId, { onValue, onError, onEnd, cleanup: () => signal?.removeEventListener('abort', aborted) });
    this.socket.send(message, error => { if (error) this.failStream(streamId, new Error('DSH Remote stream send failed')); });
    return () => {
      const stream = this.streams.get(streamId);
      if (!this.streams.delete(streamId)) return;
      stream?.cleanup?.();
      this.cancelStream(streamId);
    };
  }

  onDisconnect(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.disconnectListeners.add(listener);
    return () => { this.disconnectListeners.delete(listener); };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error('DSH Remote client disposed');
    this.cancelConnecting?.(error);
    for (const fail of this.requests.values()) fail(error);
    for (const streamId of [...this.streams.keys()]) this.failStream(streamId, error);
    this.disconnectListeners.clear();
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
  }

  private validateEndpoint(endpoint: string): void {
    if (!/^[a-zA-Z0-9_$-]+(?:\/[a-zA-Z0-9_$-]+)*$/.test(endpoint)) throw new Error('Invalid DSH Remote endpoint');
  }

  private isFailure(value: unknown): value is { code: string; message: string; details: Record<string, unknown> } {
    return record(value) && typeof value.code === 'string' && typeof value.message === 'string' && record(value.details);
  }

  private receive(text: string, isBinary: boolean): void {
    let frame: unknown;
    try { if (isBinary) throw new Error(); frame = JSON.parse(text); } catch { this.invalidCarrier(); return; }
    if (!record(frame) || typeof frame.streamId !== 'string' || !frame.streamId) { this.invalidCarrier(); return; }
    const streamId = frame.streamId;
    const stream = this.streams.get(streamId);
    if (!stream) return;
    if (frame.type === 'item' && (exactKeys(frame, ['type', 'streamId']) || exactKeys(frame, ['type', 'streamId', 'value']))) {
      try { stream.onValue(frame.value); } catch { this.failStream(streamId, new Error('DSH Remote stream consumer failed')); }
    } else if (frame.type === 'end' && exactKeys(frame, ['type', 'streamId'])) {
      this.streams.delete(streamId);
      stream.cleanup?.();
      try { stream.onEnd?.(); } catch { /* Stream completion observers are isolated. */ }
    } else if (frame.type === 'error' && exactKeys(frame, ['type', 'streamId', 'error']) && this.isFailure(frame.error)
      && exactKeys(frame.error, ['code', 'message', 'details'])) {
      this.failStream(streamId, new DshRemoteError(frame.error.code), false);
    } else this.failStream(streamId, new Error('Invalid DSH Remote stream frame'));
  }

  private invalidCarrier(): void {
    const socket = this.socket;
    if (!socket) return;
    this.lost(socket, new Error('Invalid DSH Remote stream frame'));
    socket.terminate();
  }

  private cancelStream(streamId: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'cancel', streamId }), () => {});
  }

  private failStream(streamId: string, error: Error, cancel = true): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    this.streams.delete(streamId);
    stream.cleanup?.();
    if (cancel) this.cancelStream(streamId);
    try { stream.onError(error); } catch { /* One consumer must not interrupt carrier cleanup. */ }
  }

  private lost(socket: WebSocket, error = new Error('DSH Remote connection closed')): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    for (const fail of this.requests.values()) fail(error);
    for (const streamId of [...this.streams.keys()]) this.failStream(streamId, error, false);
    for (const listener of this.disconnectListeners) {
      try { listener(); } catch { /* Disconnect listeners have independent lifetimes. */ }
    }
  }
}
