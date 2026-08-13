import type { McpStorageAdapter } from '../../../core/mcp/McpServerManager';
import { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type {
  ManagedMcpServer,
  McpServerConfig,
} from '../../../core/types';
import { getMcpServerType } from '../../../core/types';

export const DSH_MCP_CONFIG_PATH = '.claude/mcp.json';

/**
 * DSH-side MCP discovery reads the Claudian-managed `.claude/mcp.json`
 * (the same store the shared MCP settings UI writes). The manager is
 * read-only from the DSH provider: enabling/disabling stays in the shared
 * MCP settings; the DSH launch overlay maps enabled servers to
 * `dsh-mcp-client` rows so the DSH agent gains real MCP tools.
 */
export class DshMcpStorage implements McpStorageAdapter {
  constructor(private readonly adapter: VaultFileAdapter) {}

  async load(): Promise<ManagedMcpServer[]> {
    try {
      if (!(await this.adapter.exists(DSH_MCP_CONFIG_PATH))) {
        return [];
      }

      const content = await this.adapter.read(DSH_MCP_CONFIG_PATH);
      const file = JSON.parse(content) as {
        _claudian?: {
          servers?: Record<string, { enabled?: boolean; contextSaving?: boolean; description?: string }>;
        };
        mcpServers?: Record<string, unknown>;
      };

      if (!file.mcpServers || typeof file.mcpServers !== 'object') {
        return [];
      }

      const claudianMeta = file._claudian?.servers ?? {};
      const servers: ManagedMcpServer[] = [];

      for (const [name, rawConfig] of Object.entries(file.mcpServers)) {
        const config = normalizeMcpConfig(rawConfig);
        if (!config) {
          continue;
        }

        const meta = claudianMeta[name] ?? {};
        servers.push({
          name,
          config,
          enabled: meta.enabled ?? true,
          contextSaving: meta.contextSaving ?? true,
          description: meta.description,
        });
      }

      return servers;
    } catch {
      return [];
    }
  }
}

export class DshMcpServerManager extends McpServerManager {
  constructor(adapter: VaultFileAdapter) {
    super(new DshMcpStorage(adapter));
  }
}

function normalizeMcpConfig(raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;

  if (typeof record.command === 'string' && record.command.trim()) {
    const config: McpServerConfig = {
      type: 'stdio',
      command: record.command.trim(),
      ...(Array.isArray(record.args)
        ? { args: record.args.filter((arg): arg is string => typeof arg === 'string') }
        : {}),
      ...(record.env && typeof record.env === 'object' && !Array.isArray(record.env)
        ? { env: record.env as Record<string, string> }
        : {}),
    };
    return config;
  }

  if (typeof record.url === 'string' && record.url.trim()) {
    const config: McpServerConfig = {
      type: getMcpServerType({ url: record.url.trim() } as McpServerConfig) === 'http' ? 'http' : 'sse',
      url: record.url.trim(),
      ...(record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)
        ? { headers: record.headers as Record<string, string> }
        : {}),
    };
    return config;
  }

  return null;
}
