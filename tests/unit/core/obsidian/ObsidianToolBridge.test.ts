import { readCanvas } from '../../../../src/core/obsidian/canvas';
import { commitCanvasWrite, undoLastCanvasWrite } from '../../../../src/core/obsidian/CanvasWriteHistory';
import { ObsidianToolBridge, type ObsidianToolBridgeHandle } from '../../../../src/core/obsidian/ObsidianToolBridge';

interface FakeFile {
  extension: string;
  path: string;
  contents: string;
}

function createApp(options?: { dataview?: boolean }) {
  const files = new Map<string, FakeFile>([
    ['A.md', { extension: 'md', path: 'A.md', contents: '---\ntags: [one]\n---\n# A' }],
    ['B.md', { extension: 'md', path: 'B.md', contents: '# B' }],
    ['board.canvas', {
      extension: 'canvas',
      path: 'board.canvas',
      contents: JSON.stringify({
        nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
        edges: [],
      }),
    }],
  ]);
  const app = {
    fileManager: {
      processFrontMatter: jest.fn(async (file: FakeFile, callback: (frontmatter: Record<string, unknown>) => void) => {
        const frontmatter: Record<string, unknown> = { tags: ['one'] };
        callback(frontmatter);
        file.contents = `---\n${Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n# A`;
      }),
    },
    metadataCache: {
      getFileCache: jest.fn(() => ({ frontmatter: { tags: ['one'] } })),
      resolvedLinks: { 'A.md': { 'B.md': 2 }, 'B.md': {} },
      unresolvedLinks: { 'A.md': { 'Missing.md': 1 } },
    },
    plugins: {
      getPlugin: jest.fn((id: string) => id === 'dataview' && options?.dataview
        ? { api: { query: jest.fn(async (query: string) => ({ query, values: [{ path: 'A.md' }] })) } }
        : null),
    },
    vault: {
      getAbstractFileByPath: jest.fn((filePath: string) => files.get(filePath) ?? null),
      getFileByPath: jest.fn((filePath: string) => files.get(filePath) ?? null),
      modify: jest.fn(async (file: FakeFile, contents: string) => { file.contents = contents; }),
      read: jest.fn(async (file: FakeFile) => file.contents),
    },
  } as any;
  return { app, files };
}

async function callBridge(
  handle: ObsidianToolBridgeHandle,
  body: Record<string, unknown>,
  token = handle.token,
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${handle.url}/tools/call`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

describe('ObsidianToolBridge', () => {
  let bridge: ObsidianToolBridge | null = null;

  afterEach(async () => {
    await bridge?.stop();
    bridge = null;
  });

  it('requires the loopback token and exposes native metadata-cache links', async () => {
    const { app } = createApp();
    bridge = new ObsidianToolBridge(app);
    const handle = await bridge.start();

    await expect(fetch(`${handle.url}/tools/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).resolves.toMatchObject({ status: 401 });

    const result = await callBridge(handle, {
      name: 'links_get',
      arguments: { path: 'A.md' },
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, source: 'native' });
    expect(result.body.result).toEqual({
      path: 'A.md',
      outgoing: [{ target: 'B.md', linkCount: 2 }],
      incoming: [],
      unresolved: ['Missing.md'],
    });
  });

  it('uses Obsidian fileManager and vault APIs for approved writes', async () => {
    const { app, files } = createApp();
    bridge = new ObsidianToolBridge(app);
    const handle = await bridge.start();

    const denied = await callBridge(handle, {
      name: 'properties_set',
      arguments: { path: 'A.md', set: { status: 'done' } },
    });
    expect(denied.status).toBe(400);
    expect(denied.body.error.message).toContain('explicit provider approval');

    const properties = await callBridge(handle, {
      name: 'properties_set',
      approved: true,
      arguments: { path: 'A.md', set: { status: 'done' } },
    });
    expect(properties.body).toMatchObject({ ok: true, result: { path: 'A.md', applied: true } });
    expect(app.fileManager.processFrontMatter).toHaveBeenCalled();

    const preview = await callBridge(handle, {
      name: 'canvas_write_preview',
      arguments: {
        path: 'board.canvas',
        plan: { nodeOps: [{ action: 'add', node: { id: 'preview-node', text: 'Preview only' } }], edgeOps: [] },
      },
    });
    expect(preview.body).toMatchObject({
      ok: true,
      result: { path: 'board.canvas', preview: true, nodeCountBefore: 1, nodeCountAfter: 2 },
    });
    expect(JSON.parse(files.get('board.canvas')!.contents).nodes).toHaveLength(1);

    const canvas = await callBridge(handle, {
      name: 'canvas_write',
      approved: true,
      arguments: {
        path: 'board.canvas',
        plan: { nodeOps: [{ action: 'add', node: { id: 'n2', text: 'B' } }], edgeOps: [] },
      },
    });
    expect(canvas.body).toMatchObject({
      ok: true,
      result: {
        path: 'board.canvas',
        applied: true,
        nodeCount: 2,
        diff: expect.stringContaining('[add] node n2'),
      },
    });
    expect(JSON.parse(files.get('board.canvas')!.contents).nodes).toHaveLength(2);

    const undone = await undoLastCanvasWrite(app.vault);
    expect(undone).toMatchObject({ path: 'board.canvas', reverted: true, nodeCount: 1 });
    expect(JSON.parse(files.get('board.canvas')!.contents).nodes).toHaveLength(1);
  });

  it('delegates Dataview queries to the installed plugin and reports fallback availability', async () => {
    const native = createApp({ dataview: true });
    bridge = new ObsidianToolBridge(native.app);
    const handle = await bridge.start();
    const result = await callBridge(handle, {
      name: 'dataview_query',
      arguments: { query: 'TABLE file.name FROM "notes"' },
    });
    expect(result.body.result).toEqual({ query: 'TABLE file.name FROM "notes"', values: [{ path: 'A.md' }] });

    await bridge.stop();
    const unavailable = createApp({ dataview: false });
    bridge = new ObsidianToolBridge(unavailable.app);
    const unavailableHandle = await bridge.start();
    const fallback = await callBridge(unavailableHandle, {
      name: 'dataview_query',
      arguments: { query: 'TABLE file.name FROM "notes"' },
    });
    expect(fallback.status).toBe(501);
    expect(fallback.body.error.code).toBe('NATIVE_UNAVAILABLE');
  });

  it('refuses to undo when the Canvas changed after the provider write', async () => {
    const { app, files } = createApp();
    bridge = new ObsidianToolBridge(app);
    const handle = await bridge.start();

    await callBridge(handle, {
      name: 'canvas_write',
      approved: true,
      arguments: {
        path: 'board.canvas',
        plan: { nodeOps: [{ action: 'add', node: { id: 'n2', text: 'B' } }], edgeOps: [] },
      },
    });
    files.get('board.canvas')!.contents = JSON.stringify({
      nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'n2', type: 'text', x: 0, y: 0, width: 300, height: 100, text: 'B' },
        { id: 'external', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'External edit' }],
      edges: [],
    });

    await expect(undoLastCanvasWrite(app.vault)).rejects.toThrow('changed after the last Claudian Plus write');
  });

  it('refuses to overwrite a Canvas changed while approval was pending', async () => {
    const { app, files } = createApp();
    const expected = (await readCanvas(app.vault, 'board.canvas')).data;
    files.get('board.canvas')!.contents = JSON.stringify({
      nodes: [{ id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' },
        { id: 'external', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'External edit' }],
      edges: [],
    });

    await expect(commitCanvasWrite(app.vault, 'board.canvas', {
      nodeOps: [{ action: 'add', node: { id: 'n2', text: 'B' } }],
      edgeOps: [],
    }, expected)).rejects.toThrow('changed while the write was awaiting approval');
  });
});
