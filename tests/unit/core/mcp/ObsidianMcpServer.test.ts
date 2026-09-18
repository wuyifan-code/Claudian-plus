import type { App } from 'obsidian';

import {
  CLAUDE_MCP_CONFIG_PATH,
  ObsidianMcpServer,
} from '@/core/mcp/ObsidianMcpServer';
import type { ObsidianToolBridge } from '@/core/obsidian/ObsidianToolBridge';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

describe('ObsidianMcpServer', () => {
  let mockApp: App;
  let mockBridge: jest.Mocked<ObsidianToolBridge>;
  let mockAdapter: jest.Mocked<VaultFileAdapter>;
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map<string, string>();
    mockAdapter = {
      exists: jest.fn().mockImplementation(async (path: string) => storage.has(path)),
      read: jest.fn().mockImplementation(async (path: string) => {
        const val = storage.get(path);
        if (val === undefined) throw new Error(`File not found: ${path}`);
        return val;
      }),
      write: jest.fn().mockImplementation(async (path: string, content: string) => {
        storage.set(path, content);
      }),
      remove: jest.fn().mockImplementation(async (path: string) => {
        storage.delete(path);
      }),
      list: jest.fn().mockResolvedValue([]),
      stat: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<VaultFileAdapter>;

    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn(),
        getMarkdownFiles: jest.fn().mockReturnValue([]),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue(null),
      },
    } as unknown as App;

    mockBridge = {
      execute: jest.fn().mockResolvedValue({ hits: [] }),
    } as unknown as jest.Mocked<ObsidianToolBridge>;
  });

  describe('Tools catalog', () => {
    it('returns all 10 obsidian native tools', () => {
      const server = new ObsidianMcpServer(mockApp, mockBridge);
      const tools = server.getTools();
      expect(tools.length).toBe(10);
      const names = tools.map((t) => t.name);
      expect(names).toContain('vault_search');
      expect(names).toContain('properties_get');
      expect(names).toContain('properties_set');
      expect(names).toContain('links_get');
      expect(names).toContain('graph_neighbors');
      expect(names).toContain('canvas_read');
      expect(names).toContain('canvas_write_preview');
      expect(names).toContain('canvas_write');
      expect(names).toContain('canvas_undo');
      expect(names).toContain('dataview_query');
    });
  });

  describe('Protocol Server and Tool Execution', () => {
    it('creates protocol server with list and call tool handlers', async () => {
      const server = new ObsidianMcpServer(mockApp, mockBridge);
      const protocolServer = await server.createProtocolServer();
      expect(protocolServer).toBeDefined();
    });

    it('delegates tool execution to bridge', async () => {
      mockBridge.execute.mockResolvedValueOnce({
        query: 'architecture',
        matches: [{ path: 'notes/system.md', score: 10 }],
      });

      const server = new ObsidianMcpServer(mockApp, mockBridge);
      const protocolServer = await server.createProtocolServer();

      // Invoke tool call handler registered on the server
      const handler = (protocolServer as any)._requestHandlers.get('tools/call');
      expect(handler).toBeDefined();

      const response = await handler({
        method: 'tools/call',
        params: {
          name: 'vault_search',
          arguments: { query: 'architecture' },
        },
      });

      expect(mockBridge.execute).toHaveBeenCalledWith({
        name: 'vault_search',
        arguments: { query: 'architecture' },
        approved: true,
      });

      expect(response.content).toBeDefined();
      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toContain('notes/system.md');
    });

    it('formats errors gracefully if tool execution fails', async () => {
      mockBridge.execute.mockRejectedValueOnce(new Error('Canvas file corrupted'));

      const server = new ObsidianMcpServer(mockApp, mockBridge);
      const protocolServer = await server.createProtocolServer();

      const handler = (protocolServer as any)._requestHandlers.get('tools/call');
      const response = await handler({
        method: 'tools/call',
        params: {
          name: 'canvas_read',
          arguments: { path: 'invalid.canvas' },
        },
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Canvas file corrupted');
    });
  });

  describe('HTTP SSE Server Lifecycle', () => {
    it('starts on dynamic port and shuts down cleanly', async () => {
      const server = new ObsidianMcpServer(mockApp, mockBridge);
      const handle = await server.start(0);

      expect(handle.port).toBeGreaterThan(0);
      expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/sse`);

      // Second start returns same handle
      const sameHandle = await server.start(0);
      expect(sameHandle).toBe(handle);

      await server.stop();
    });
  });

  describe('Config Registration', () => {
    it('registers obsidian mcp server into empty .claude/mcp.json', async () => {
      await ObsidianMcpServer.registerInMcpConfigFile(mockAdapter, 38123);

      expect(mockAdapter.write).toHaveBeenCalled();
      const content = storage.get(CLAUDE_MCP_CONFIG_PATH);
      expect(content).toBeDefined();
      const parsed = JSON.parse(content!);
      expect(parsed.mcpServers.obsidian).toEqual({
        url: 'http://127.0.0.1:38123/sse',
      });
    });

    it('preserves existing servers when registering', async () => {
      storage.set(
        CLAUDE_MCP_CONFIG_PATH,
        JSON.stringify({
          mcpServers: {
            github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
          },
        })
      );

      await ObsidianMcpServer.registerInMcpConfigFile(mockAdapter, 39999);

      const parsed = JSON.parse(storage.get(CLAUDE_MCP_CONFIG_PATH)!);
      expect(parsed.mcpServers.github).toBeDefined();
      expect(parsed.mcpServers.obsidian).toEqual({
        url: 'http://127.0.0.1:39999/sse',
      });
    });

    it('unregisters obsidian mcp server cleanly', async () => {
      storage.set(
        CLAUDE_MCP_CONFIG_PATH,
        JSON.stringify({
          mcpServers: {
            github: { command: 'npx' },
            obsidian: { url: 'http://127.0.0.1:39999/sse' },
          },
        })
      );

      await ObsidianMcpServer.unregisterFromMcpConfigFile(mockAdapter);

      const parsed = JSON.parse(storage.get(CLAUDE_MCP_CONFIG_PATH)!);
      expect(parsed.mcpServers.github).toBeDefined();
      expect(parsed.mcpServers.obsidian).toBeUndefined();
    });
  });
});
