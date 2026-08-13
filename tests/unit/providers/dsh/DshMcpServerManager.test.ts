import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { DshMcpServerManager } from '@/providers/dsh/app/DshMcpServerManager';

function createAdapter(files: Record<string, string>): Pick<VaultFileAdapter, 'exists' | 'read'> {
  return {
    async exists(filePath: string): Promise<boolean> {
      return filePath in files;
    },
    async read(filePath: string): Promise<string> {
      const content = files[filePath];
      if (content === undefined) {
        throw new Error(`missing file: ${filePath}`);
      }
      return content;
    },
  };
}

describe('DshMcpServerManager', () => {
  it('loads stdio and http servers from .claude/mcp.json', async () => {
    const adapter = createAdapter({
      '.claude/mcp.json': JSON.stringify({
        mcpServers: {
          filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
          remote: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } },
        },
      }),
    });
    const manager = new DshMcpServerManager(adapter as never);
    await manager.ensureLoaded();

    const servers = manager.getServers();
    expect(servers).toHaveLength(2);
    const fsServer = servers.find((server) => server.name === 'filesystem');
    expect(fsServer?.config).toMatchObject({ type: 'stdio', command: 'npx' });
    expect(fsServer?.enabled).toBe(true);
    const httpServer = servers.find((server) => server.name === 'remote');
    expect(httpServer?.config).toMatchObject({ type: 'http', url: 'https://mcp.example.com/mcp' });
  });

  it('applies _claudian enablement metadata', async () => {
    const adapter = createAdapter({
      '.claude/mcp.json': JSON.stringify({
        mcpServers: {
          off: { command: 'node', args: ['server.js'] },
        },
        _claudian: {
          servers: {
            off: { enabled: false },
          },
        },
      }),
    });
    const manager = new DshMcpServerManager(adapter as never);
    await manager.ensureLoaded();
    expect(manager.getServers()[0]?.enabled).toBe(false);
  });

  it('returns an empty list when the config file is missing or invalid', async () => {
    const missing = new DshMcpServerManager(createAdapter({}) as never);
    await missing.ensureLoaded();
    expect(missing.getServers()).toEqual([]);

    const invalid = new DshMcpServerManager(createAdapter({
      '.claude/mcp.json': 'not json',
    }) as never);
    await invalid.ensureLoaded();
    expect(invalid.getServers()).toEqual([]);
  });

  it('skips servers with invalid configs', async () => {
    const adapter = createAdapter({
      '.claude/mcp.json': JSON.stringify({
        mcpServers: {
          broken: { nonsense: true },
          good: { command: 'echo' },
        },
      }),
    });
    const manager = new DshMcpServerManager(adapter as never);
    await manager.ensureLoaded();
    expect(manager.getServers().map((server) => server.name)).toEqual(['good']);
  });
});
