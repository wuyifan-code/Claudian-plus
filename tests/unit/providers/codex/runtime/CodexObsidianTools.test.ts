import { createCodexObsidianTools } from '@/providers/codex/runtime/CodexObsidianTools';

type FakeFile = {
  path: string;
  extension: string;
  content?: string;
};

function createApp() {
  const files: Record<string, FakeFile> = {
    'maps/project.canvas': {
      path: 'maps/project.canvas',
      extension: 'canvas',
      content: JSON.stringify({
        nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100, text: 'A' }],
        edges: [],
      }),
    },
    'notes/a.md': { path: 'notes/a.md', extension: 'md', content: '---\ntags: [one]\n---\n# A' },
    'notes/b.md': { path: 'notes/b.md', extension: 'md', content: '# B' },
  };
  const frontmatter: Record<string, Record<string, unknown>> = {
    'notes/a.md': { tags: ['one'] },
  };
  const app = {
    vault: {
      getFileByPath: jest.fn((path: string) => files[path] ?? null),
      getAbstractFileByPath: jest.fn((path: string) => files[path] ?? null),
      read: jest.fn(async (file: FakeFile) => file.content ?? ''),
      modify: jest.fn(async (file: FakeFile, content: string) => { file.content = content; }),
    },
    metadataCache: {
      resolvedLinks: {
        'notes/a.md': { 'notes/b.md': 2 },
        'notes/b.md': { 'notes/a.md': 1 },
      },
      unresolvedLinks: { 'notes/a.md': { 'notes/missing': 1 } },
      getFileCache: jest.fn((file: FakeFile) => ({ frontmatter: frontmatter[file.path] ?? {} })),
    },
    fileManager: {
      processFrontMatter: jest.fn(async (file: FakeFile, callback: (fm: Record<string, unknown>) => void) => {
        const fm = { ...(frontmatter[file.path] ?? {}) };
        callback(fm);
        frontmatter[file.path] = fm;
      }),
    },
    plugins: {
      getPlugin: jest.fn(() => null),
    },
  } as any;
  return app;
}

function callTool(registrations: ReturnType<typeof createCodexObsidianTools>, name: string, args: unknown) {
  const registration = registrations.find(item => item.tool.name === name);
  if (!registration) throw new Error(`Missing tool ${name}`);
  return registration.handler({
    threadId: 'thread',
    turnId: 'turn',
    callId: 'call',
    namespace: 'obsidian',
    tool: name,
    arguments: args,
  });
}

describe('Codex Obsidian tools', () => {
  it('reads canvas data and rejects host path traversal', async () => {
    const app = createApp();
    const tools = createCodexObsidianTools(app, () => null);

    await expect(callTool(tools, 'canvas_read', { path: 'maps/project.canvas' })).resolves.toMatchObject({
      success: true,
      contentItems: [{ text: expect.stringContaining('"id": "a"') }],
    });
    await expect(callTool(tools, 'canvas_read', { path: '../outside.canvas' })).resolves.toMatchObject({
      success: false,
      contentItems: [{ text: expect.stringContaining('relative path') }],
    });

    const preview = await callTool(tools, 'canvas_write_preview', {
      path: 'maps/project.canvas',
      plan: { nodeOps: [{ action: 'add', node: { id: 'b', text: 'B' } }], edgeOps: [] },
    });
    expect(preview).toMatchObject({ success: true, contentItems: [{ text: expect.stringContaining('"preview": true') }] });
    expect(JSON.parse(app.vault.getFileByPath('maps/project.canvas').content).nodes).toHaveLength(1);
  });

  it('requires approval before changing properties', async () => {
    const app = createApp();
    const deny = createCodexObsidianTools(app, () => async () => 'deny');
    await expect(callTool(deny, 'properties_set', { path: 'notes/a.md', set: { status: 'done' } }))
      .resolves.toMatchObject({ success: false });
    expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();

    const allow = createCodexObsidianTools(app, () => async () => 'allow');
    await expect(callTool(allow, 'properties_set', { path: 'notes/a.md', set: { status: 'done' } }))
      .resolves.toMatchObject({ success: true });
    expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
  });

  it('returns incoming, outgoing, unresolved links and bounded graph neighbors', async () => {
    const app = createApp();
    const tools = createCodexObsidianTools(app, () => null);
    const links = await callTool(tools, 'links_get', { path: 'notes/a.md' });
    expect(links).toMatchObject({ success: true });
    const linksText = (links.contentItems[0] as { text: string }).text;
    expect(linksText).toContain('notes/missing');
    expect(linksText).toContain('notes/b.md');

    const graph = await callTool(tools, 'graph_neighbors', { path: 'notes/a.md', depth: 2 });
    expect((graph.contentItems[0] as { text: string }).text).toContain('notes/b.md');
  });

  it('reports a clear fallback when Dataview is unavailable', async () => {
    const app = createApp();
    const tools = createCodexObsidianTools(app, () => null);
    await expect(callTool(tools, 'dataview_query', { query: 'TABLE file.name FROM "notes"' }))
      .resolves.toMatchObject({
        success: false,
        contentItems: [{ text: expect.stringContaining('Dataview is not installed') }],
      });
  });
});
