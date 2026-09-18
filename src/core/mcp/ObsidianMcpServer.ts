import * as http from 'node:http';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { App } from 'obsidian';

import { ObsidianToolBridge } from '../obsidian/ObsidianToolBridge';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import { loadMcpSdkValue } from './McpSdkLoader';

export const CLAUDE_MCP_CONFIG_PATH = '.claude/mcp.json';

export const OBSIDIAN_MCP_TOOLS: Tool[] = [
  {
    name: 'vault_search',
    description: 'Search vault notes by keywords matching note titles, tags, and headings.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms or keywords' },
        limit: { type: 'number', description: 'Maximum number of results to return (default: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'properties_get',
    description: 'Read frontmatter metadata properties for a Markdown note.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative or absolute file path to the markdown note' },
      },
      required: ['path'],
    },
  },
  {
    name: 'properties_set',
    description: 'Set or update frontmatter metadata properties for a Markdown note.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative file path' },
        properties: { type: 'object', description: 'Key-value map of properties to set' },
        merge: { type: 'boolean', description: 'Whether to merge with existing properties (default: true)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'links_get',
    description: 'Get incoming backlinks and outgoing forward links for a Markdown file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'graph_neighbors',
    description: 'Get graph neighbors connected to a note up to a specified depth.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative file path' },
        depth: { type: 'number', description: 'Graph traversal depth (1 or 2, default: 1)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'canvas_read',
    description: 'Read an Obsidian Canvas file (.canvas) structure including nodes and edges.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative file path to the .canvas file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'canvas_write_preview',
    description: 'Preview changes that would be made to an Obsidian Canvas file before applying.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative file path to the .canvas file' },
        plan: { type: 'object', description: 'Canvas write plan object' },
      },
      required: ['path', 'plan'],
    },
  },
  {
    name: 'canvas_write',
    description: 'Apply a write plan to create or modify an Obsidian Canvas file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative file path to the .canvas file' },
        plan: { type: 'object', description: 'Canvas write plan object' },
      },
      required: ['path', 'plan'],
    },
  },
  {
    name: 'canvas_undo',
    description: 'Undo the last write operation to an Obsidian Canvas file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative file path to the .canvas file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'dataview_query',
    description: 'Execute a Dataview DQL query against vault notes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Dataview DQL query string' },
      },
      required: ['query'],
    },
  },
];

export interface ObsidianMcpServerHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

const OBSIDIAN_MCP_FEATURE = 'the Obsidian MCP server';

export class ObsidianMcpServer {
  private app: App;
  private bridge: ObsidianToolBridge;
  private server: http.Server | null = null;
  private handle: ObsidianMcpServerHandle | null = null;
  private activeTransports = new Map<string, SSEServerTransport>();

  constructor(app: App, bridge?: ObsidianToolBridge) {
    this.app = app;
    this.bridge = bridge ?? new ObsidianToolBridge(app);
  }

  getTools(): Tool[] {
    return [...OBSIDIAN_MCP_TOOLS];
  }

  async createProtocolServer(): Promise<Server> {
    const { Server } = await loadMcpSdkValue(
      OBSIDIAN_MCP_FEATURE,
      () => import('@modelcontextprotocol/sdk/server/index.js'),
    );
    const { CallToolRequestSchema, ListToolsRequestSchema } = await loadMcpSdkValue(
      OBSIDIAN_MCP_FEATURE,
      () => import('@modelcontextprotocol/sdk/types.js'),
    );

    const server = new Server(
      {
        name: 'claudian-plus-obsidian',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const result = await this.bridge.execute({
          name,
          arguments: args ?? {},
          approved: true,
        });

        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    });

    return server;
  }

  async start(preferredPort = 0): Promise<ObsidianMcpServerHandle> {
    if (this.handle) {
      return this.handle;
    }

    // Resolve the externalized SDK before binding a port, so a missing module
    // fails here with an actionable error instead of inside every SSE request.
    const { SSEServerTransport } = await loadMcpSdkValue(
      OBSIDIAN_MCP_FEATURE,
      () => import('@modelcontextprotocol/sdk/server/sse.js'),
    );

    const httpServer = http.createServer((req, res) => {
      void (async () => {
      const address = httpServer.address();
      const port = typeof address === 'object' && address ? address.port : preferredPort;
      const parsedUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

      if (req.method === 'GET' && parsedUrl.pathname === '/sse') {
        const transport = new SSEServerTransport('/messages', res);
        this.activeTransports.set(transport.sessionId, transport);

        transport.onclose = () => {
          this.activeTransports.delete(transport.sessionId);
        };

        const protocolServer = await this.createProtocolServer();
        await protocolServer.connect(transport);
        return;
      }

      if (req.method === 'POST' && parsedUrl.pathname === '/messages') {
        const sessionId = parsedUrl.searchParams.get('sessionId');
        if (!sessionId) {
          res.statusCode = 400;
          res.end('Missing sessionId parameter');
          return;
        }

        const transport = this.activeTransports.get(sessionId);
        if (!transport) {
          res.statusCode = 404;
          res.end('Session not found');
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      res.statusCode = 404;
      res.end('Not found');
      })();
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(preferredPort, '127.0.0.1', () => {
        httpServer.removeListener('error', reject);
        resolve();
      });
    });

    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : preferredPort;
    const url = `http://127.0.0.1:${port}/sse`;

    const handle: ObsidianMcpServerHandle = {
      port,
      url,
      close: async () => {
        await this.stop();
      },
    };

    this.server = httpServer;
    this.handle = handle;
    return handle;
  }

  async stop(): Promise<void> {
    for (const transport of this.activeTransports.values()) {
      try {
        await transport.close();
      } catch {
        // Ignore transport close errors
      }
    }
    this.activeTransports.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
    this.handle = null;
  }

  static async registerInMcpConfigFile(
    adapter: VaultFileAdapter,
    port: number,
    serverName = 'obsidian'
  ): Promise<void> {
    let config: Record<string, unknown> = {};
    if (await adapter.exists(CLAUDE_MCP_CONFIG_PATH)) {
      try {
        const content = await adapter.read(CLAUDE_MCP_CONFIG_PATH);
        config = JSON.parse(content) as Record<string, unknown>;
      } catch {
        config = {};
      }
    }

    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      config.mcpServers = {};
    }

    (config.mcpServers as Record<string, unknown>)[serverName] = {
      url: `http://127.0.0.1:${port}/sse`,
    };

    await adapter.write(CLAUDE_MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  static async unregisterFromMcpConfigFile(
    adapter: VaultFileAdapter,
    serverName = 'obsidian'
  ): Promise<void> {
    if (!(await adapter.exists(CLAUDE_MCP_CONFIG_PATH))) {
      return;
    }
    try {
      const content = await adapter.read(CLAUDE_MCP_CONFIG_PATH);
      const config = JSON.parse(content) as Record<string, unknown>;
      if (config.mcpServers && typeof config.mcpServers === 'object' && serverName in (config.mcpServers as Record<string, unknown>)) {
        delete (config.mcpServers as Record<string, unknown>)[serverName];
        await adapter.write(CLAUDE_MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
      }
    } catch {
      // Ignore malformed config
    }
  }
}
