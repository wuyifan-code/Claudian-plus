/**
 * Persists generated-UI widget state into SessionMetadata so it survives
 * Obsidian reloads.
 *
 * This is a strictly private channel: values flow store -> metadata -> store
 * and never into the model context (the `@ToAssistant` context argument in
 * followUp.ts is the only model-facing channel).
 *
 * Writes are debounced and merged read-modify-write. Metadata is re-read
 * immediately before each save and only the uiState field is replaced, so a
 * concurrent writer that lands before that re-read keeps its fields; a write
 * landing inside the save window itself is still last-writer-wins.
 */

import type { SessionMetadata } from '../../../../core/types/chat';
import { type UiStateStore, uiStateStore } from './stateStore';

export const UI_STATE_FLUSH_DEBOUNCE_MS = 500;
export const UI_STATE_BLOCK_LIMIT_CHARS = 16 * 1024;
export const UI_STATE_SESSION_LIMIT_CHARS = 64 * 1024;

/** Bounded retries for a flush batch whose metadata load or save failed. */
const MAX_FLUSH_RETRIES = 3;

/** blockKey -> state name -> JSON-safe value. */
export type SessionUiState = Record<string, Record<string, unknown>>;

/** Host surface the controller needs; the plugin implements it. */
export interface UiStatePersistenceHost {
  loadSessionMetadata?(id: string): Promise<SessionMetadata | null>;
  saveSessionMetadata?(metadata: SessionMetadata): Promise<void>;
}

/** Renderer surface the controller drives; MessageRenderer implements it. */
export interface UiStateOwnerRenderer {
  setUiOwnerId(ownerId: string | undefined): void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True for values JSON can round-trip: what a metadata file may legally hold. */
export function isJsonSafeValue(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }
  const object = value;
  if (seen.has(object)) return false;
  seen.add(object);
  let safe = true;
  if (Array.isArray(object)) {
    for (const item of object) {
      if (!isJsonSafeValue(item, seen)) {
        safe = false;
        break;
      }
    }
  } else if (isPlainObject(object)) {
    for (const key of Object.keys(object)) {
      if (!isJsonSafeValue(object[key], seen)) {
        safe = false;
        break;
      }
    }
  } else {
    safe = false;
  }
  seen.delete(object);
  return safe;
}

export function isSessionUiState(value: unknown): value is SessionUiState {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(entry => isPlainObject(entry));
}

/** A flush's unit of work for one scope; empty entries mean "drop the block". */
export interface UiStateWrite {
  scope: string;
  entries: Record<string, unknown>;
}

function blockSizeChars(entries: Record<string, unknown> | undefined): number {
  if (entries === undefined) return 0;
  const serialized = JSON.stringify(entries);
  return serialized === undefined ? Number.MAX_SAFE_INTEGER : serialized.length;
}

function sessionSizeChars(state: SessionUiState): number {
  let total = 0;
  for (const entries of Object.values(state)) {
    total += blockSizeChars(entries);
  }
  return total;
}

/**
 * Applies pending scope writes onto the previously persisted state.
 * A block whose serialized entries exceed the block limit keeps its previous
 * value; once the whole session would exceed the session limit, further new
 * writes are dropped.
 */
export function mergeUiStateWrites(previous: SessionUiState, writes: UiStateWrite[]): SessionUiState {
  const next: SessionUiState = { ...previous };
  const candidates: Array<{ scope: string; entries: Record<string, unknown>; serialized: string }> = [];
  for (const write of writes) {
    if (Object.keys(write.entries).length === 0) {
      delete next[write.scope];
      continue;
    }
    const serialized = JSON.stringify(write.entries);
    if (serialized === undefined || serialized.length > UI_STATE_BLOCK_LIMIT_CHARS) {
      continue;
    }
    candidates.push({ scope: write.scope, entries: write.entries, serialized });
  }
  candidates.sort((a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
  for (const candidate of candidates) {
    const totalWithoutBlock = sessionSizeChars(next) - blockSizeChars(next[candidate.scope]);
    if (totalWithoutBlock + candidate.serialized.length > UI_STATE_SESSION_LIMIT_CHARS) {
      continue;
    }
    next[candidate.scope] = candidate.entries;
  }
  return next;
}

/** Writes persisted values back into the store, rejecting non-JSON hand edits. */
export function hydrateUiState(
  store: UiStateStore,
  metadata: SessionMetadata,
  skipScopes?: ReadonlySet<string>,
): void {
  if (!isSessionUiState(metadata.uiState)) return;
  for (const [scope, entries] of Object.entries(metadata.uiState)) {
    if (skipScopes?.has(scope)) continue;
    for (const [name, value] of Object.entries(entries)) {
      if (!isJsonSafeValue(value)) continue;
      store.set(scope, name, value);
    }
  }
}

/**
 * Keeps only scopes owned by `ownerId`. Block keys are conversation-scoped
 * (`uiBlockKey`), so legacy message-scoped keys and keys foreign to this
 * conversation can never be read again; a flush drops them for good.
 */
export function pruneForeignUiScopes(state: SessionUiState, ownerId: string): SessionUiState {
  const prefix = `${ownerId}:`;
  const next: SessionUiState = {};
  for (const [scope, entries] of Object.entries(state)) {
    if (scope.startsWith(prefix)) next[scope] = entries;
  }
  return next;
}

/** Clears every scope claimed by a conversation (deletion / teardown). */
export function releaseConversationUiState(
  conversationId: string,
  store: UiStateStore = uiStateStore,
): void {
  for (const scope of store.scopesOf(conversationId)) {
    store.clearScope(scope);
  }
}

function jsonSafeEntries(entries: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(entries)) {
    if (isJsonSafeValue(value)) safe[name] = value;
  }
  return safe;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Per-tab bridge between the shared widget store and session metadata.
 *
 * Only scopes claimed by the tab's active conversation are persisted; scopes
 * claimed as `live` (unowned, e.g. before lazy conversation creation) stay
 * in memory only.
 */
export class UiStatePersistenceController {
  private readonly store: UiStateStore;
  private readonly host: UiStatePersistenceHost;
  private readonly renderer?: UiStateOwnerRenderer;
  private readonly debounceMs: number;
  private readonly unsubscribe: () => void;
  private activeOwnerId: string | undefined;
  private readonly dirtyScopes = new Set<string>();
  private flushTimer: number | null = null;
  private flushFailures = 0;
  private hydrating = false;
  private disposed = false;

  constructor(deps: {
    host: UiStatePersistenceHost;
    renderer?: UiStateOwnerRenderer;
    store?: UiStateStore;
    debounceMs?: number;
  }) {
    this.host = deps.host;
    this.renderer = deps.renderer;
    this.store = deps.store ?? uiStateStore;
    this.debounceMs = deps.debounceMs ?? UI_STATE_FLUSH_DEBOUNCE_MS;
    this.unsubscribe = this.store.subscribe(scope => this.handleStoreChange(scope));
  }

  /** Binds the tab to a conversation: claims route to it and stored state is restored. */
  activate(conversationId: string): void {
    if (this.disposed || this.activeOwnerId === conversationId) return;
    const previous = this.activeOwnerId;
    this.activeOwnerId = conversationId;
    this.renderer?.setUiOwnerId(conversationId);
    if (previous !== undefined) void this.flushOwner(previous);
    // Widgets mounted before the lazy conversation creation claimed no owner
    // ('live') and their subscription re-renders never re-claim; adopt them
    // here or their state would never persist. First activation wins: a live
    // scope belongs to whichever conversation is activated while it is still
    // unowned.
    for (const scope of this.store.scopesOf('live')) {
      this.store.claim(scope, conversationId);
      this.dirtyScopes.add(scope);
    }
    void this.loadAndHydrate(conversationId);
  }

  /** Unbinds the tab (blank entry point) after flushing pending writes. */
  deactivate(): void {
    if (this.disposed) return;
    const previous = this.activeOwnerId;
    this.activeOwnerId = undefined;
    this.renderer?.setUiOwnerId(undefined);
    this.cancelTimer();
    if (previous !== undefined) void this.flushOwner(previous);
  }

  hydrate(metadata: SessionMetadata): void {
    this.hydrating = true;
    try {
      hydrateUiState(this.store, metadata);
    } finally {
      this.hydrating = false;
    }
  }

  release(conversationId: string): void {
    releaseConversationUiState(conversationId, this.store);
  }

  /** Runs the pending debounced flush immediately. */
  async flush(): Promise<void> {
    if (this.activeOwnerId === undefined) return;
    this.cancelTimer();
    await this.flushOwner(this.activeOwnerId);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTimer();
    this.unsubscribe();
    const previous = this.activeOwnerId;
    this.activeOwnerId = undefined;
    this.renderer?.setUiOwnerId(undefined);
    if (previous !== undefined) await this.flushOwner(previous);
  }

  private async loadAndHydrate(conversationId: string): Promise<void> {
    if (this.host.loadSessionMetadata === undefined) return;
    let metadata: SessionMetadata | null;
    try {
      metadata = await this.host.loadSessionMetadata(conversationId);
    } catch {
      return;
    }
    if (this.disposed || this.activeOwnerId !== conversationId || metadata === null) return;
    this.hydrating = true;
    try {
      // A scope with pending writes was touched after this load started;
      // hydrating it would snap the widget back to the persisted value.
      hydrateUiState(this.store, metadata, this.dirtyScopes);
    } finally {
      this.hydrating = false;
    }
  }

  private handleStoreChange(scope: string): void {
    if (this.hydrating || this.activeOwnerId === undefined) return;
    if (!this.store.scopesOf(this.activeOwnerId).includes(scope)) return;
    this.dirtyScopes.add(scope);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null || this.disposed) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      if (this.activeOwnerId === undefined) return;
      void this.flushOwner(this.activeOwnerId);
    }, this.debounceMs);
  }

  private cancelTimer(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async flushOwner(ownerId: string): Promise<void> {
    const scopes = Array.from(this.dirtyScopes);
    this.dirtyScopes.clear();
    // A scope whose claim moved to another conversation must not land in this
    // owner's metadata.
    const owned = new Set(this.store.scopesOf(ownerId));
    const batch = scopes.filter(scope => owned.has(scope));
    if (batch.length === 0) return;
    if (this.host.loadSessionMetadata === undefined || this.host.saveSessionMetadata === undefined) {
      return;
    }

    let latest: SessionMetadata | null;
    try {
      latest = await this.host.loadSessionMetadata(ownerId);
    } catch {
      this.retryFailedFlush(batch);
      return;
    }
    if (latest === null) {
      this.retryFailedFlush(batch);
      return;
    }

    const writes = batch.map(scope => ({
      scope,
      entries: jsonSafeEntries(this.store.scopeEntries(scope)),
    }));

    // Re-read right before saving: a metadata writer that landed while this
    // flush was preparing keeps its fields; only uiState is replaced below.
    let freshest: SessionMetadata = latest;
    try {
      freshest = await this.host.loadSessionMetadata(ownerId) ?? latest;
    } catch {
      // Fall back to the first snapshot rather than dropping the flush.
    }

    const previous = pruneForeignUiScopes(
      isSessionUiState(freshest.uiState) ? freshest.uiState : {},
      ownerId,
    );
    const next = mergeUiStateWrites(previous, writes);
    if (stableStringify(next) === stableStringify(previous)) {
      this.flushFailures = 0;
      return;
    }

    try {
      await this.host.saveSessionMetadata({ ...freshest, uiState: next });
    } catch {
      this.retryFailedFlush(batch);
      return;
    }
    this.flushFailures = 0;
  }

  /** Requeues a failed flush batch with a bounded number of retries. */
  private retryFailedFlush(scopes: string[]): void {
    if (this.flushFailures >= MAX_FLUSH_RETRIES) return;
    this.flushFailures += 1;
    for (const scope of scopes) this.dirtyScopes.add(scope);
    this.scheduleFlush();
  }
}
