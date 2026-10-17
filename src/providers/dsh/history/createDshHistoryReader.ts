import { isDshObject } from '../normalization/dshRecords';
import type { DshHost, DshHostLease } from '../runtime/DshHost';
import { type DshHistoryReader, type DshHistorySnapshot, normalizeDshHistoryHome } from './DshHistoryService';

interface HistoryReaderOptions {
  timeoutMs?: number;
  preset?: string;
}

function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('DeepSeek history read cancelled.');
}

function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(cancellationError(signal));
    void promise.then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); });
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}

async function useLease<T>(host: DshHost, timeoutMs: number, signal: AbortSignal | undefined,
  operation: (lease: DshHostLease, signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const aborted = () => controller.abort(new Error('DeepSeek history read cancelled.'));
  if (signal?.aborted) aborted();
  signal?.addEventListener('abort', aborted, { once: true });
  const timer = window.setTimeout(() => controller.abort(new Error('DeepSeek history read timed out.')), timeoutMs);
  let lease: DshHostLease | undefined;
  try {
    if (controller.signal.aborted) throw cancellationError(controller.signal);
    const acquiring = host.acquire(controller.signal).then(value => {
      if (controller.signal.aborted) { value.release(); throw cancellationError(controller.signal); }
      return value;
    });
    lease = await withSignal(acquiring, controller.signal);
    await withSignal(lease.ready(), controller.signal);
    return await withSignal(operation(lease, controller.signal), controller.signal);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    lease?.release();
  }
}

function openingSnapshot(lease: DshHostLease, sessionId: string, signal: AbortSignal): Promise<DshHistorySnapshot> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    const aborted = () => finish(cancellationError(signal));
    const finish = (error?: Error, value?: DshHistorySnapshot) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      unsubscribe?.();
      if (error) reject(error); else resolve(value!);
    };
    if (signal.aborted) { finish(cancellationError(signal)); return; }
    signal.addEventListener('abort', aborted, { once: true });
    try {
      unsubscribe = lease.client.subscribe('session/follow', { args: { request: {
        address: { kind: 'session', sessionId }, maxMessages: 100,
      } } }, value => {
        if (!isDshObject(value) || value.type !== 'snapshot' || !Number.isSafeInteger(value.cursor)
          || (value.cursor as number) < -1 || !Array.isArray(value.records) || typeof value.hasMore !== 'boolean') {
          finish(new Error('Malformed DeepSeek history opening snapshot.'));
        } else finish(undefined, value as unknown as DshHistorySnapshot);
      }, error => finish(error), undefined, () => finish(new Error('DeepSeek history stream ended before its snapshot.')));
      if (settled) unsubscribe();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('DeepSeek history subscription failed.'));
    }
  });
}

/** Each operation borrows a Host lease; closing a read subscription never cancels native work. */
export async function createDshHistoryReader(host: DshHost, options: HistoryReaderOptions = {}): Promise<DshHistoryReader> {
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid DeepSeek history timeout.');
  const home = await useLease(host, timeoutMs, undefined, async lease => lease.home);
  const verify = (lease: DshHostLease) => {
    if (normalizeDshHistoryHome(home) !== normalizeDshHistoryHome(lease.home)) {
      throw new Error('DeepSeek native home changed while reading history.');
    }
  };
  return {
    home,
    preset: options.preset ?? 'claudian-plus',
    call<T>(method: string, args?: unknown, lookup?: unknown, signal?: AbortSignal): Promise<T> {
      if ((args !== undefined && !isDshObject(args)) || (lookup !== undefined && !isDshObject(lookup))) {
        return Promise.reject(new Error('Malformed DeepSeek history request.'));
      }
      return useLease(host, timeoutMs, signal, async (lease, activeSignal) => {
        verify(lease);
        return lease.client.call<T>(method, args, lookup, activeSignal);
      });
    },
    snapshot(sessionId, signal) {
      return useLease(host, timeoutMs, signal, async (lease, activeSignal) => {
        verify(lease);
        return openingSnapshot(lease, sessionId, activeSignal);
      });
    },
  };
}
