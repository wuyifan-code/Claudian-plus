import type { DshRemoteClient } from '../remote/DshRemoteClient';

export interface DshNativeConnection {
  client: DshRemoteClient;
  home: string;
  dispose(): Promise<void>;
}
export type DshEventOutcome = { kind: 'next' } | { kind: 'result'; value: unknown };
export type DshEventHandler = (event: { event: string; request: Record<string, unknown>; signal: AbortSignal }) => Promise<DshEventOutcome>;
export interface DshHostLease {
  client: DshRemoteClient;
  home: string;
  claim(sessionId: string, handler?: DshEventHandler): void;
  ready(): Promise<void>;
  release(): void;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** One workspace-owned native process; leases own tabs, never native work. */
export class DshHost {
  private connection?: DshNativeConnection;
  private starting?: Promise<DshNativeConnection>;
  private stopping?: Promise<void>;
  private eventReady?: Promise<void>;
  private unsubscribe?: () => void;
  private offDisconnect?: () => void;
  private generation = 0;
  private users = 0;
  private disposed = false;
  private idle?: number;
  private readonly lifetime = new AbortController();
  private readonly owners = new Map<string, { token: object; handler?: DshEventHandler }>();
  private readonly pending = new Map<string, { controller: AbortController; token?: object; withdraw(): void }>();

  constructor(private readonly start: (signal: AbortSignal) => Promise<DshNativeConnection>, private readonly idleMs = 30000,
    private readonly validateConfiguration: () => void = () => {}) {}

  private async getConnection(): Promise<DshNativeConnection> {
    if (this.disposed) throw new Error('DeepSeek Harness Host disposed');
    if (this.stopping) await this.stopping;
    if (this.disposed) throw new Error('DeepSeek Harness Host disposed');
    if (this.connection) return this.connection;
    if (!this.starting) {
      this.starting = this.start(this.lifetime.signal).then(async connection => {
        if (this.disposed) { await connection.dispose(); throw new Error('DeepSeek Harness Host disposed'); }
        this.connection = connection;
        this.offDisconnect = connection.client.onDisconnect(() => this.invalidateEvents());
        return connection;
      }).finally(() => { this.starting = undefined; });
    }
    return this.starting;
  }

  private invalidateEvents(): void {
    this.generation++;
    this.eventReady = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const { controller } of this.pending.values()) controller.abort();
    this.pending.clear();
  }

  private async ready(connection: DshNativeConnection): Promise<void> {
    this.validateConfiguration();
    if (this.disposed || connection !== this.connection) return Promise.reject(new Error('DeepSeek Harness Host disposed'));
    if (!this.eventReady) {
      const generation = ++this.generation;
      const ready = this.openEvents(connection, generation);
      this.eventReady = ready;
      void ready.catch(() => { if (this.eventReady === ready) this.eventReady = undefined; });
    }
    return this.eventReady;
  }

  private async openEvents(connection: DshNativeConnection, generation: number): Promise<void> {
    await connection.client.connect(this.lifetime.signal);
    if (this.disposed || generation !== this.generation) throw new Error('DeepSeek Harness event connection changed');
    await new Promise<void>((resolve, reject) => {
      let clientId: string | undefined;
      let settled = false;
      const timer = window.setTimeout(() => finish(new Error('DeepSeek Harness event stream timed out')), 15000);
      const aborted = () => finish(new Error('DeepSeek Harness Host disposed'));
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.lifetime.signal.removeEventListener('abort', aborted);
        if (error) {
          if (generation === this.generation) this.invalidateEvents();
          reject(error);
        } else resolve();
      };
      this.lifetime.signal.addEventListener('abort', aborted, { once: true });
      try {
        this.unsubscribe = connection.client.subscribe('$events', { args: {} }, frame => {
          if (generation !== this.generation || !object(frame)) return;
          if (frame.type === 'ready' && typeof frame.clientId === 'string' && frame.clientId) {
            clientId = frame.clientId;
            finish();
          } else if (frame.type === 'cancel' && typeof frame.eventId === 'string') {
            this.pending.get(frame.eventId)?.controller.abort();
            this.pending.delete(frame.eventId);
          } else if (clientId && frame.type === 'waterfall' && typeof frame.eventId === 'string'
            && typeof frame.agentId === 'string' && typeof frame.event === 'string' && object(frame.request)) {
            void this.handleEvent(connection, generation, clientId, frame as {
              eventId: string; agentId: string; event: string; request: Record<string, unknown>;
            });
          }
        }, error => { finish(error); this.invalidateEvents(); }, undefined, () => {
          finish(new Error('DeepSeek Harness event stream ended'));
          this.invalidateEvents();
        });
      } catch (error) { finish(error instanceof Error ? error : new Error('DeepSeek Harness event stream could not start')); }
    });
  }

  private async handleEvent(connection: DshNativeConnection, generation: number, clientId: string,
    frame: { eventId: string; agentId: string; event: string; request: Record<string, unknown> }): Promise<void> {
    const controller = new AbortController();
    const owner = this.owners.get(frame.agentId);
    this.pending.set(frame.eventId, { controller, token: owner?.token, withdraw: () => {
      controller.abort();
      if (!this.disposed && generation === this.generation) {
        void connection.client.call('$events/result', { clientId, eventId: frame.eventId, outcome: { kind: 'next' } }).catch(() => {});
      }
    } });
    let outcome: unknown = { kind: 'next' };
    try {
      if (owner?.handler) outcome = await owner.handler({ event: frame.event, request: frame.request, signal: controller.signal });
    } catch {
      outcome = { kind: 'rejected', error: { name: 'Error', message: 'Claudian Plus could not complete the interaction.' } };
    }
    this.pending.delete(frame.eventId);
    if (controller.signal.aborted || this.disposed || generation !== this.generation) return;
    try { await connection.client.call('$events/result', { clientId, eventId: frame.eventId, outcome }); } catch {
      // Disconnect cancels the native continuation; never replay an approval.
    }
  }

  async acquire(signal?: AbortSignal): Promise<DshHostLease> {
    this.validateConfiguration();
    if (signal?.aborted) throw new Error('DeepSeek Harness acquisition cancelled');
    window.clearTimeout(this.idle);
    this.users++;
    try {
      const connection = await this.getConnection();
      await this.ready(connection);
      if (this.disposed || signal?.aborted) throw new Error('DeepSeek Harness acquisition cancelled or disposed');
      const token = {};
      let released = false;
      return {
        client: connection.client, home: connection.home,
        claim: (sessionId, handler) => {
          if (released || this.disposed) throw new Error('DeepSeek Harness lease released');
          const existing = this.owners.get(sessionId);
          if (existing && existing.token !== token) throw new Error('DeepSeek Harness session already owned by another tab');
          this.owners.set(sessionId, { token, handler });
        },
        ready: () => released ? Promise.reject(new Error('DeepSeek Harness lease released')) : this.ready(connection),
        release: () => {
          if (released) return;
          released = true;
          for (const [sessionId, owner] of this.owners) if (owner.token === token) this.owners.delete(sessionId);
          for (const [eventId, pending] of this.pending) {
            if (pending.token !== token) continue;
            pending.withdraw();
            this.pending.delete(eventId);
          }
          this.releaseUser();
        },
      };
    } catch (error) { this.releaseUser(); throw error; }
  }

  private releaseUser(): void {
    this.users--;
    if (!this.users && !this.disposed) this.idle = window.setTimeout(() => { void this.stopConnection(); }, this.idleMs);
  }

  private stopConnection(): Promise<void> {
    if (this.stopping) return this.stopping;
    const connection = this.connection;
    this.connection = undefined;
    this.offDisconnect?.();
    this.offDisconnect = undefined;
    this.invalidateEvents();
    const stopping = (async () => { await connection?.dispose(); })().finally(() => {
      if (this.stopping === stopping) this.stopping = undefined;
    });
    this.stopping = stopping;
    return stopping;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.idle);
    this.lifetime.abort();
    this.owners.clear();
    await this.starting?.catch(() => {});
    await this.stopConnection();
  }
}
