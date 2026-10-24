import type { SessionMetadata } from '@/core/types/chat';
import { buildUiContinuationPrompt } from '@/features/chat/rendering/ui/followUp';
import { UiStateStore } from '@/features/chat/rendering/ui/stateStore';
import {
  hydrateUiState,
  isJsonSafeValue,
  releaseConversationUiState,
  UI_STATE_BLOCK_LIMIT_CHARS,
  UI_STATE_FLUSH_DEBOUNCE_MS,
  UI_STATE_SESSION_LIMIT_CHARS,
  UiStatePersistenceController,
} from '@/features/chat/rendering/ui/uiStatePersistence';

function createHost(files: Map<string, SessionMetadata>) {
  return {
    loadSessionMetadata: jest.fn(async (id: string): Promise<SessionMetadata | null> =>
      files.get(id) ?? null),
    saveSessionMetadata: jest.fn(async (metadata: SessionMetadata): Promise<void> => {
      files.set(metadata.id, metadata);
    }),
  };
}

function metadata(id: string, extra: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    id,
    title: `Title ${id}`,
    createdAt: 1,
    updatedAt: 2,
    providerState: { keep: true },
    ...extra,
  };
}

/** Builds entries whose JSON serialization is exactly `size` characters. */
function sizedEntries(size: number): Record<string, unknown> {
  const overhead = JSON.stringify({ v: '' }).length;
  return { v: 'x'.repeat(size - overhead) };
}

describe('UiStatePersistenceController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces widget writes into one merged save that keeps other metadata fields', async () => {
    const store = new UiStateStore();
    const files = new Map([['conv-1', metadata('conv-1')]]);
    const host = createHost(files);
    const renderer = { setUiOwnerId: jest.fn() };
    const controller = new UiStatePersistenceController({ host, renderer, store });

    controller.activate('conv-1');
    expect(renderer.setUiOwnerId).toHaveBeenCalledWith('conv-1');
    await jest.advanceTimersByTimeAsync(0);

    store.claim('conv-1:m1:0', 'conv-1');
    store.claim('conv-1:m1:1', 'conv-1');
    store.set('conv-1:m1:0', 'day', 'Mon');
    store.set('conv-1:m1:1', 'count', 3);
    store.set('conv-1:m1:0', 'day', 'Tue');

    await jest.advanceTimersByTimeAsync(UI_STATE_FLUSH_DEBOUNCE_MS);

    expect(host.saveSessionMetadata).toHaveBeenCalledTimes(1);
    const saved = host.saveSessionMetadata.mock.calls[0][0];
    expect(saved.title).toBe('Title conv-1');
    expect(saved.providerState).toEqual({ keep: true });
    expect(saved.createdAt).toBe(1);
    expect(saved.updatedAt).toBe(2);
    expect(saved.uiState).toEqual({
      'conv-1:m1:0': { day: 'Tue' },
      'conv-1:m1:1': { count: 3 },
    });
  });

  it('never persists scopes that are not claimed by the active conversation', async () => {
    const store = new UiStateStore();
    const files = new Map([['conv-1', metadata('conv-1')]]);
    const host = createHost(files);
    const controller = new UiStatePersistenceController({ host, store });

    controller.activate('conv-1');
    await jest.advanceTimersByTimeAsync(0);

    store.claim('m-live:0', 'live');
    store.set('m-live:0', 'day', 'Mon');

    await jest.advanceTimersByTimeAsync(600);
    expect(host.saveSessionMetadata).not.toHaveBeenCalled();
  });

  it('flushes pending writes immediately on deactivate', async () => {
    const store = new UiStateStore();
    const files = new Map([['conv-1', metadata('conv-1')]]);
    const host = createHost(files);
    const renderer = { setUiOwnerId: jest.fn() };
    const controller = new UiStatePersistenceController({ host, renderer, store });

    controller.activate('conv-1');
    await jest.advanceTimersByTimeAsync(0);

    store.claim('conv-1:m1:0', 'conv-1');
    store.set('conv-1:m1:0', 'day', 'Mon');

    controller.deactivate();
    await jest.advanceTimersByTimeAsync(0);

    expect(renderer.setUiOwnerId).toHaveBeenCalledWith(undefined);
    expect(host.saveSessionMetadata).toHaveBeenCalledTimes(1);
    expect(host.saveSessionMetadata.mock.calls[0][0].uiState).toEqual({
      'conv-1:m1:0': { day: 'Mon' },
    });
  });

  it('drops a block write whose serialized state exceeds the per-block limit', async () => {
    const store = new UiStateStore();
    const files = new Map([
      ['conv-1', metadata('conv-1', { uiState: { 'conv-1:m-big:0': { v: 'small' } } })],
    ]);
    const host = createHost(files);
    const controller = new UiStatePersistenceController({ host, store });

    controller.activate('conv-1');
    await jest.advanceTimersByTimeAsync(0);

    store.claim('conv-1:m-big:0', 'conv-1');
    store.set('conv-1:m-big:0', 'v', 'x'.repeat(UI_STATE_BLOCK_LIMIT_CHARS));

    await jest.advanceTimersByTimeAsync(600);

    // The oversized write is discarded, so the previously persisted small
    // value survives untouched and no save happens at all.
    expect(host.saveSessionMetadata).not.toHaveBeenCalled();
    expect(files.get('conv-1')?.uiState).toEqual({ 'conv-1:m-big:0': { v: 'small' } });
  });

  it('drops new block writes once the whole session exceeds the session limit', async () => {
    const store = new UiStateStore();
    const files = new Map([['conv-1', metadata('conv-1')]]);
    const host = createHost(files);
    const controller = new UiStatePersistenceController({ host, store });

    controller.activate('conv-1');
    await jest.advanceTimersByTimeAsync(0);

    // Five 15000-char blocks: four fit under 64 KiB, the fifth does not.
    const blockSize = 15000;
    for (let i = 0; i < 5; i++) {
      store.claim(`conv-1:k${i}:0`, 'conv-1');
      store.set(`conv-1:k${i}:0`, 'v', sizedEntries(blockSize).v);
    }

    await jest.advanceTimersByTimeAsync(600);

    expect(host.saveSessionMetadata).toHaveBeenCalledTimes(1);
    const saved = host.saveSessionMetadata.mock.calls[0][0];
    expect(Object.keys(saved.uiState ?? {}).sort()).toEqual([
      'conv-1:k0:0',
      'conv-1:k1:0',
      'conv-1:k2:0',
      'conv-1:k3:0',
    ]);
    const total = Object.values(saved.uiState ?? {})
      .reduce((sum, block) => sum + JSON.stringify(block).length, 0);
    expect(total).toBeLessThanOrEqual(UI_STATE_SESSION_LIMIT_CHARS);
  });

  it('drops legacy and foreign-conversation scopes from persisted uiState', async () => {
    const store = new UiStateStore();
    const files = new Map([['conv-1', metadata('conv-1', {
      uiState: {
        'm1:0': { day: 'legacy' },
        'conv-2:m2:0': { day: 'foreign' },
        'conv-1:m3:0': { day: 'keep' },
      },
    })]]);
    const host = createHost(files);
    const controller = new UiStatePersistenceController({ host, store });

    controller.activate('conv-1');
    await jest.advanceTimersByTimeAsync(0);

    store.claim('conv-1:m4:0', 'conv-1');
    store.set('conv-1:m4:0', 'day', 'Mon');
    await jest.advanceTimersByTimeAsync(UI_STATE_FLUSH_DEBOUNCE_MS);

    const saved = host.saveSessionMetadata.mock.calls[0][0];
    expect(saved.uiState).toEqual({
      'conv-1:m3:0': { day: 'keep' },
      'conv-1:m4:0': { day: 'Mon' },
    });
  });

  it('re-reads metadata before saving so concurrent field writes survive', async () => {
    const store = new UiStateStore();
    const before = metadata('conv-1');
    const after = metadata('conv-1', { title: 'Renamed', updatedAt: 9 });
    const files = new Map([['conv-1', before]]);
    const host = createHost(files);
    const controller = new UiStatePersistenceController({ host, store });

    controller.activate('conv-1');
    await jest.advanceTimersByTimeAsync(0);

    // The flush's first load sees the old snapshot; a title writer lands
    // before the save, so the pre-save re-read must pick it up.
    host.loadSessionMetadata
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    store.claim('conv-1:m1:0', 'conv-1');
    store.set('conv-1:m1:0', 'day', 'Mon');
    await jest.advanceTimersByTimeAsync(UI_STATE_FLUSH_DEBOUNCE_MS);

    expect(host.saveSessionMetadata).toHaveBeenCalledTimes(1);
    const saved = host.saveSessionMetadata.mock.calls[0][0];
    expect(saved.title).toBe('Renamed');
    expect(saved.updatedAt).toBe(9);
    expect(saved.uiState).toEqual({ 'conv-1:m1:0': { day: 'Mon' } });
  });

  it('retries a flush whose metadata load failed and gives up after bounded tries', async () => {
    const store = new UiStateStore();
    const files = new Map([['conv-1', metadata('conv-1')]]);
    const host = createHost(files);
    host.loadSessionMetadata = jest.fn(async (_id: string): Promise<SessionMetadata | null> => {
      throw new Error('disk hiccup');
    });
    const controller = new UiStatePersistenceController({ host, store });

    controller.activate('conv-1');
    await jest.advanceTimersByTimeAsync(0);

    store.claim('conv-1:m1:0', 'conv-1');
    store.set('conv-1:m1:0', 'day', 'Mon');
    await jest.advanceTimersByTimeAsync(UI_STATE_FLUSH_DEBOUNCE_MS * 10);

    // One activate load plus one initial flush attempt and three scheduled
    // retries; afterwards the batch is dropped instead of looping forever.
    expect(host.loadSessionMetadata).toHaveBeenCalledTimes(5);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('persists a flushed batch on the next retry after a transient load failure', async () => {
    const store = new UiStateStore();
    const files = new Map([['conv-1', metadata('conv-1')]]);
    const host = createHost(files);
    const controller = new UiStatePersistenceController({ host, store });

    controller.activate('conv-1');
    await jest.advanceTimersByTimeAsync(0);

    host.loadSessionMetadata.mockRejectedValueOnce(new Error('transient'));
    store.claim('conv-1:m1:0', 'conv-1');
    store.set('conv-1:m1:0', 'day', 'Mon');
    await jest.advanceTimersByTimeAsync(UI_STATE_FLUSH_DEBOUNCE_MS * 3);

    expect(host.saveSessionMetadata).toHaveBeenCalledTimes(1);
    expect(host.saveSessionMetadata.mock.calls[0][0].uiState).toEqual({
      'conv-1:m1:0': { day: 'Mon' },
    });
  });

  it('does not hydrate over a scope the user touched while metadata was loading', async () => {
    const store = new UiStateStore();
    const persisted = metadata('conv-1', {
      uiState: {
        'conv-1:touched:0': { day: 'Mon' },
        'conv-1:untouched:0': { day: 'Tue' },
      },
    });
    const files = new Map([['conv-1', persisted]]);
    const host = createHost(files);
    let resolveLoad: (value: SessionMetadata | null) => void = () => undefined;
    host.loadSessionMetadata = jest.fn((_id: string) =>
      new Promise<SessionMetadata | null>((resolve) => {
        resolveLoad = resolve;
      }));
    const controller = new UiStatePersistenceController({ host, store });

    controller.activate('conv-1');
    // While the metadata load is in flight the user interacts with one widget.
    store.claim('conv-1:touched:0', 'conv-1');
    store.set('conv-1:touched:0', 'day', 'Fri');
    resolveLoad(persisted);
    await jest.advanceTimersByTimeAsync(0);

    expect(store.get('conv-1:touched:0', 'day')).toBe('Fri');
    expect(store.get('conv-1:untouched:0', 'day')).toBe('Tue');
  });

  it('hydrates persisted JSON-safe values back into the store', () => {
    const store = new UiStateStore();
    hydrateUiState(store, metadata('conv-1', {
      uiState: {
        'm1:0': {
          text: 'Mon',
          number: 2,
          flag: true,
          nil: null,
          list: [1, 'a', null],
          nested: { k: 'v' },
        },
      },
    }));

    expect(store.get('m1:0', 'text')).toBe('Mon');
    expect(store.get('m1:0', 'number')).toBe(2);
    expect(store.get('m1:0', 'flag')).toBe(true);
    expect(store.get('m1:0', 'nil')).toBe(null);
    expect(store.get('m1:0', 'list')).toEqual([1, 'a', null]);
    expect(store.get('m1:0', 'nested')).toEqual({ k: 'v' });
  });

  it('rejects hand-edited non-JSON values during hydrate', () => {
    const store = new UiStateStore();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    hydrateUiState(store, metadata('conv-1', {
      // Values JSON parsing can never produce; only a hand-edited meta file has them.
      uiState: {
        'm2:0': {
          fn: (() => 1) as unknown,
          missing: undefined as unknown as null,
          nan: Number.NaN,
          date: new Date(0) as unknown,
          cyclic,
          poisoned: { ok: 1, bad: Number.NaN },
        },
        'm2:1': 'not-a-record' as unknown as Record<string, unknown>,
      },
    }));

    expect(store.scopeEntries('m2:0')).toEqual({});
    expect(store.scopeEntries('m2:1')).toEqual({});
  });

  it('adopts live-claimed scopes on first activation so lazy conversations persist', async () => {
    const store = new UiStateStore();
    const files = new Map([['conv-1', metadata('conv-1')]]);
    const host = createHost(files);
    const controller = new UiStatePersistenceController({ host, store });

    // Widgets mount while the first turn streams, before the lazy save has
    // created a conversation id, so their scopes claim no owner.
    store.claim('conv-1:m1:0', 'live');
    store.set('conv-1:m1:0', 'day', 'Mon');

    controller.activate('conv-1');
    expect(store.scopesOf('live')).toEqual([]);
    expect(store.scopesOf('conv-1')).toContain('conv-1:m1:0');

    store.set('conv-1:m1:0', 'day', 'Tue');
    await jest.advanceTimersByTimeAsync(UI_STATE_FLUSH_DEBOUNCE_MS);

    expect(host.saveSessionMetadata).toHaveBeenCalledTimes(1);
    expect(host.saveSessionMetadata.mock.calls[0][0].uiState).toEqual({
      'conv-1:m1:0': { day: 'Tue' },
    });
  });

  it('adopts live-claimed scopes when switching into a fresh conversation from an existing one', async () => {
    const store = new UiStateStore();
    const files = new Map([
      ['conv-1', metadata('conv-1')],
      ['conv-2', metadata('conv-2')],
    ]);
    const host = createHost(files);
    const controller = new UiStatePersistenceController({ host, store });

    controller.activate('conv-1');

    // The tab starts a new conversation; widgets mount before the lazy save
    // creates the next conversation id, so they claim no owner.
    store.claim('conv-2:m1:0', 'live');
    store.set('conv-2:m1:0', 'day', 'Mon');

    controller.activate('conv-2');
    expect(store.scopesOf('live')).toEqual([]);
    expect(store.scopesOf('conv-2')).toContain('conv-2:m1:0');

    store.set('conv-2:m1:0', 'day', 'Tue');
    await jest.advanceTimersByTimeAsync(UI_STATE_FLUSH_DEBOUNCE_MS);

    expect(host.saveSessionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-2', uiState: { 'conv-2:m1:0': { day: 'Tue' } } }),
    );
  });

  it('releases every scope claimed by a conversation', () => {
    const store = new UiStateStore();
    store.claim('m1:0', 'conv-1');
    store.claim('m1:1', 'conv-1');
    store.claim('m9:0', 'conv-2');
    store.set('m1:0', 'day', 'Mon');

    releaseConversationUiState('conv-1', store);

    expect(store.scopeEntries('m1:0')).toEqual({});
    expect(store.scopesOf('conv-1')).toEqual([]);
    expect(store.scopesOf('conv-2')).toEqual(['m9:0']);
  });

  it('keeps widget state out of the follow-up prompt channel', () => {
    const store = new UiStateStore();
    hydrateUiState(store, metadata('conv-1', {
      uiState: { 'm1:0': { day: 'Tue' } },
    }));
    store.claim('m1:0', 'conv-1');

    const promptOnly = buildUiContinuationPrompt('Pick a day', undefined);
    expect(promptOnly).toBe('Pick a day');
    expect(promptOnly).not.toContain('Tue');

    const withContext = buildUiContinuationPrompt('Pick', { chosen: 'Mon' });
    expect(withContext).toContain('<untrusted_ui_state>');
    expect(withContext).toContain('"chosen":"Mon"');
    expect(withContext).not.toContain('Tue');
  });
});

describe('isJsonSafeValue', () => {
  it('accepts JSON primitives and containers, rejects everything else', () => {
    expect(isJsonSafeValue('a')).toBe(true);
    expect(isJsonSafeValue(1)).toBe(true);
    expect(isJsonSafeValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonSafeValue(Number.NaN)).toBe(false);
    expect(isJsonSafeValue(true)).toBe(true);
    expect(isJsonSafeValue(null)).toBe(true);
    expect(isJsonSafeValue([1, { a: null }])).toBe(true);
    expect(isJsonSafeValue({ a: { b: [true] } })).toBe(true);
    expect(isJsonSafeValue(undefined)).toBe(false);
    expect(isJsonSafeValue(() => 1)).toBe(false);
    expect(isJsonSafeValue(new Date(0))).toBe(false);
    expect(isJsonSafeValue({ a: undefined })).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isJsonSafeValue(cyclic)).toBe(false);
  });
});
