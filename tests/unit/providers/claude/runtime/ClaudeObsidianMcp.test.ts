import type { App } from 'obsidian';

import { createClaudeObsidianMcpServer } from '@/providers/claude/runtime/ClaudeObsidianMcp';

describe('createClaudeObsidianMcpServer', () => {
  let mockApp: App;

  beforeEach(() => {
    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn(),
        getMarkdownFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue(null),
      },
    } as unknown as App;
  });

  it('creates an MCP server with all tools including vault_search', async () => {
    const serverConfig = await createClaudeObsidianMcpServer(mockApp, () => null);
    expect(serverConfig).toBeDefined();
    expect(serverConfig.instance).toBeDefined();

    // The SDK server instance exposes registered tools
    const tools = (serverConfig.instance as any)._tools ?? [];
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('vault_search');
    expect(toolNames).toContain('canvas_read');
    expect(toolNames).toContain('canvas_write');
    expect(toolNames).toContain('properties_get');
    expect(toolNames).toContain('properties_set');
    expect(toolNames).toContain('links_get');
    expect(toolNames).toContain('graph_neighbors');
    expect(toolNames).toContain('dataview_query');
    expect(toolNames).toContain('canvas_undo');
  });
});
