import { testMcpServer } from '@/core/mcp/McpTester';
import type { ManagedMcpServer } from '@/core/types';

// The MCP SDK is externalized, so the installed plugin folder cannot resolve it.
// A missing module must degrade MCP server testing instead of breaking plugin load.
jest.mock('@modelcontextprotocol/sdk/client', () => {
  throw new Error("Cannot find module '@modelcontextprotocol/sdk/client'");
});

const stdioServer: ManagedMcpServer = {
  name: 'stdio',
  config: { command: 'node server.js' },
  enabled: true,
  contextSaving: false,
};

describe('testMcpServer without a resolvable MCP SDK', () => {
  it('returns the unavailable error for a stdio server', async () => {
    const result = await testMcpServer(stdioServer);

    expect(result.success).toBe(false);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain('The MCP SDK is not bundled in this build');
    expect(result.error).toContain('MCP server testing is unavailable');
    expect(result.error).toContain("Cannot find module '@modelcontextprotocol/sdk/client'");
  });

  it('returns the unavailable error for an HTTP server', async () => {
    const result = await testMcpServer({
      name: 'http',
      config: { type: 'http' as const, url: 'https://example.com/api' },
      enabled: true,
      contextSaving: false,
    });

    expect(result.success).toBe(false);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain('The MCP SDK is not bundled in this build');
  });
});
