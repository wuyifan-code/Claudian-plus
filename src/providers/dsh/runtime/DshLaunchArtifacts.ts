import * as fs from 'node:fs';
import * as path from 'node:path';

import { CLAUDIAN_PLUS_STORAGE_PATH } from '../../../core/bootstrap/StoragePaths';
import type { ManagedMcpServer } from '../../../core/types';
import { getMcpServerType } from '../../../core/types';

export interface PrepareDshLaunchArtifactsParams {
  /** Vault skill roots mounted into the DSH agent's skill filesystem. */
  skillDirs?: string[];
  /** Enabled MCP servers mapped to dsh-mcp-client rows (stdio/http only). */
  mcpServers?: ManagedMcpServer[];
  model: string;
  profile: string;
  providerRoute: string;
  /** Reasoning effort pinned into the llm-deepseek row (deepseek-official route only). */
  reasoningEffort?: 'high' | 'max' | 'off';
  /** Profile llm model catalog, preserved when the overlay pins reasoning. */
  llmModels?: Array<{ contextWindow?: number; id: string; label?: string }>;
  workspaceRoot: string;
}

export interface DshLaunchArtifacts {
  launchKey: string;
  patchPath: string;
}

const ACP_AGENT_ROW_ID = 'acp-agent';
const LLM_DEEPSEEK_ROW_ID = 'llm-deepseek';
const DEEPSEEK_OFFICIAL_ROUTE = 'deepseek-official';
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * DSH ACP agents read their provider route and model from the profile's
 * `acp-agent` row. The Loader applies a `--patch` overlay by REPLACING the
 * targeted row's config, so the overlay must carry the complete acp-demo
 * config (provider, model, and required `workspaceContext`), not just the
 * values Claudian Plus manages. Skill roots and MCP server rows are appended
 * as `insert` entries so the DSH agent actually loads vault skills and MCP
 * tools. Write the overlay under the vault's managed storage so the user's
 * profile is never mutated.
 */
export async function prepareDshLaunchArtifacts(
  params: PrepareDshLaunchArtifactsParams,
): Promise<DshLaunchArtifacts> {
  const patchPath = path.join(
    params.workspaceRoot,
    CLAUDIAN_PLUS_STORAGE_PATH,
    'dsh',
    'acp.patch.yml',
  );
  const mcpRows = buildMcpRows(params.mcpServers ?? []);
  writeIfChanged(patchPath, buildOverlay(params, mcpRows));

  return {
    launchKey: JSON.stringify({
      mcpServers: mcpRows.map((row) => row.serverName).sort(),
      model: params.model,
      profile: params.profile,
      providerRoute: params.providerRoute,
      reasoningEffort: params.reasoningEffort ?? null,
      skillDirs: [...(params.skillDirs ?? [])].sort(),
    }),
    patchPath,
  };
}

function buildOverlay(
  params: PrepareDshLaunchArtifactsParams,
  mcpRows: Array<{ row: string; serverName: string }>,
): string {
  const yamlValue = (value: string): string => `'${sanitizeYamlScalar(value)}'`;
  const lines: string[] = [
    `# Claudian Plus-managed overlay for the ${ACP_AGENT_ROW_ID} row.`,
    '# Edits here are overwritten; change the profile cordis.patch.yml instead.',
    `- id: ${ACP_AGENT_ROW_ID}`,
    '  config:',
    `    provider: ${yamlValue(params.providerRoute)}`,
    `    model: ${yamlValue(params.model)}`,
    "    persistenceRoot: './.sessions'",
    '    workspaceContext:',
    '      maxBytes: 65536',
    '    persona: >-',
    '      You are a coding assistant powered by the {{model}} model. Your working directory is {{cwd}}.',
    '      Verify your work by running the code or tests. Keep answers brief and factual.',
  ];

  const skillDirs = (params.skillDirs ?? []).filter((dir) => dir.trim());
  if (skillDirs.length > 0) {
    lines.push('    skills:');
    lines.push('      filesystem:');
    lines.push('        customSkillDirs:');
    for (const dir of skillDirs) {
      lines.push(`          - ${yamlValue(dir)}`);
    }
  }

  // The deepseek-official adapter reads thinking/reasoningEffort from its
  // llm row config. The overlay replaces that row wholesale (loader replace
  // semantics), so the full llm-deepseek config is emitted; other routes
  // (pi-ai) are left untouched.
  if (params.providerRoute === DEEPSEEK_OFFICIAL_ROUTE && params.reasoningEffort) {
    const effort = params.reasoningEffort;
    const llmModels = (params.llmModels ?? []).length > 0
      ? params.llmModels!
      : [
        { contextWindow: 1000000, id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
        { contextWindow: 1000000, id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      ];
    lines.push('');
    lines.push(`- id: ${LLM_DEEPSEEK_ROW_ID}`);
    lines.push('  config:');
    lines.push(`    apiKeyEnv: ${yamlValue('DEEPSEEK_API_KEY')}`);
    if (effort === 'off') {
      lines.push('    thinking: disabled');
    } else {
      lines.push('    thinking: enabled');
      lines.push(`    reasoningEffort: ${yamlValue(effort)}`);
    }
    lines.push('    models:');
    for (const llmModel of llmModels) {
      lines.push(`      - id: ${yamlValue(llmModel.id)}`);
      if (llmModel.label) {
        lines.push(`        name: ${yamlValue(llmModel.label)}`);
      }
      if (llmModel.contextWindow !== undefined) {
        lines.push(`        contextWindow: ${llmModel.contextWindow}`);
      }
    }
  }

  lines.push('');

  if (mcpRows.length > 0) {
    lines.push('- insert:');
    for (const mcp of mcpRows) {
      lines.push(mcp.row);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildMcpRows(
  servers: ManagedMcpServer[],
): Array<{ row: string; serverName: string }> {
  const rows: Array<{ row: string; serverName: string }> = [];
  for (const server of servers) {
    if (!server.enabled || !MCP_SERVER_NAME_PATTERN.test(server.name)) {
      continue;
    }
    const type = getMcpServerType(server.config);
    if (type === 'sse') {
      // dsh-mcp-client supports stdio and streamable-http only.
      continue;
    }

    const yamlValue = (value: string): string => `'${sanitizeYamlScalar(value)}'`;
    const lines: string[] = [
      `    - id: mcp-${server.name}`,
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      `        serverName: ${yamlValue(server.name)}`,
    ];

    if (type === 'http' && 'url' in server.config) {
      lines.push('        transport: streamable-http');
      lines.push(`        url: ${yamlValue(server.config.url)}`);
      const headers = server.config.headers;
      if (headers && Object.keys(headers).length > 0) {
        lines.push('        headers:');
        for (const [key, value] of Object.entries(headers)) {
          lines.push(`          ${yamlValue(key)}: ${yamlValue(value)}`);
        }
      }
    } else if ('command' in server.config) {
      lines.push('        transport: stdio');
      lines.push(`        command: ${yamlValue(server.config.command)}`);
      if (server.config.args && server.config.args.length > 0) {
        lines.push('        args:');
        for (const arg of server.config.args) {
          lines.push(`          - ${yamlValue(arg)}`);
        }
      }
      const env = server.config.env;
      if (env && Object.keys(env).length > 0) {
        lines.push('        env:');
        for (const [key, value] of Object.entries(env)) {
          lines.push(`          ${yamlValue(key)}: ${yamlValue(value)}`);
        }
      }
    }

    rows.push({ row: lines.join('\n'), serverName: server.name });
  }
  return rows;
}

function sanitizeYamlScalar(value: string): string {
  return value.replace(/['\r\n]/g, '').trim();
}

function writeIfChanged(filePath: string, content: string): void {
  try {
    if (fs.readFileSync(filePath, 'utf8') === content) {
      return;
    }
  } catch {
    // Missing or unreadable file; rewrite it below.
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}
