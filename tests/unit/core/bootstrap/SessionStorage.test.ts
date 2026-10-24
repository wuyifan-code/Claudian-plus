import { SESSIONS_PATH,SessionStorage } from '@/core/bootstrap/SessionStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { SessionMetadata } from '@/core/types';

function createAdapter(files = new Map<string, string>()): VaultFileAdapter {
  return {
    exists: async (path: string) => files.has(path),
    read: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`missing: ${path}`);
      return content;
    },
    write: async (path: string, content: string) => {
      files.set(path, content);
    },
    delete: async (path: string) => {
      files.delete(path);
    },
    listFiles: async () => [...files.keys()],
  } as unknown as VaultFileAdapter;
}

function metadata(id: string, extra: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    id,
    title: `Title ${id}`,
    createdAt: 1,
    updatedAt: 2,
    ...extra,
  };
}

function metaPath(id: string): string {
  return `${SESSIONS_PATH}/${id}.meta.json`;
}

function writeFile(storage: SessionStorage, files: Map<string, string>, meta: SessionMetadata): void {
  files.set(metaPath(meta.id), JSON.stringify(meta, null, 2));
  void storage; // storage kept for future assertions; the raw write bypasses it on purpose
}

describe('SessionStorage uiState', () => {
  it('loads a valid uiState through loadMetadata', async () => {
    const files = new Map<string, string>();
    const storage = new SessionStorage(createAdapter(files));
    const uiState = { 'm1:0': { day: 'Mon' }, 'm1:1': { count: 3 } };
    writeFile(storage, files, metadata('conv-1', { uiState }));

    const loaded = await storage.loadMetadata('conv-1');

    expect(loaded?.uiState).toEqual(uiState);
  });

  it('drops a malformed uiState on load', async () => {
    const files = new Map<string, string>();
    const storage = new SessionStorage(createAdapter(files));
    writeFile(storage, files, metadata('conv-1', {
      uiState: { 'm1:0': 'not-a-record' } as unknown as SessionMetadata['uiState'],
    }));

    const loaded = await storage.loadMetadata('conv-1');

    expect(loaded?.uiState).toBeUndefined();
  });

  it('preserves the on-disk uiState when a caller saves metadata without one', async () => {
    const files = new Map<string, string>();
    const storage = new SessionStorage(createAdapter(files));
    writeFile(storage, files, metadata('conv-1', {
      uiState: { 'm1:0': { day: 'Mon' } },
    }));

    // toSessionMetadata-style rebuild: fresh fields, no uiState carried over.
    await storage.saveMetadata(metadata('conv-1', { title: 'Renamed', updatedAt: 3 }));

    const persisted = JSON.parse(files.get(metaPath('conv-1')) ?? '{}');
    expect(persisted.title).toBe('Renamed');
    expect(persisted.updatedAt).toBe(3);
    expect(persisted.uiState).toEqual({ 'm1:0': { day: 'Mon' } });
  });

  it('overwrites the uiState when the caller provides one explicitly', async () => {
    const files = new Map<string, string>();
    const storage = new SessionStorage(createAdapter(files));
    writeFile(storage, files, metadata('conv-1', {
      uiState: { 'm1:0': { day: 'Mon' } },
    }));

    await storage.saveMetadata(metadata('conv-1', { uiState: { 'm2:0': { day: 'Tue' } } }));

    const persisted = JSON.parse(files.get(metaPath('conv-1')) ?? '{}');
    expect(persisted.uiState).toEqual({ 'm2:0': { day: 'Tue' } });
  });

  it('clears the uiState when the caller saves an empty map', async () => {
    const files = new Map<string, string>();
    const storage = new SessionStorage(createAdapter(files));
    writeFile(storage, files, metadata('conv-1', {
      uiState: { 'm1:0': { day: 'Mon' } },
    }));

    await storage.saveMetadata(metadata('conv-1', { uiState: {} }));

    const persisted = JSON.parse(files.get(metaPath('conv-1')) ?? '{}');
    expect(persisted.uiState).toEqual({});
  });
});
