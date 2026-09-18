import type { App } from 'obsidian';

import { ObsidianMcpServer } from '@/core/mcp/ObsidianMcpServer';
import type { ObsidianToolBridge } from '@/core/obsidian/ObsidianToolBridge';

// The MCP SDK is externalized, so the installed plugin folder cannot resolve it.
// A missing module must degrade the Obsidian MCP server instead of breaking plugin load.
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  throw new Error("Cannot find module '@modelcontextprotocol/sdk/server/index.js'");
});
jest.mock('@modelcontextprotocol/sdk/server/sse.js', () => {
  throw new Error("Cannot find module '@modelcontextprotocol/sdk/server/sse.js'");
});

describe('ObsidianMcpServer without a resolvable MCP SDK', () => {
  const app = { vault: {}, metadataCache: {} } as unknown as App;
  const bridge = { execute: jest.fn() } as unknown as ObsidianToolBridge;

  it('rejects start() with the unavailable error instead of a raw module error', async () => {
    const server = new ObsidianMcpServer(app, bridge);

    await expect(server.start()).rejects.toThrow(
      /The MCP SDK is not bundled in this build, so the Obsidian MCP server is unavailable/,
    );
    await expect(server.start()).rejects.toThrow(
      /Cannot find module '@modelcontextprotocol\/sdk\/server\/sse\.js'/,
    );
  });

  it('rejects createProtocolServer() with the unavailable error', async () => {
    const server = new ObsidianMcpServer(app, bridge);

    await expect(server.createProtocolServer()).rejects.toThrow(
      /The MCP SDK is not bundled in this build, so the Obsidian MCP server is unavailable/,
    );
  });
});
