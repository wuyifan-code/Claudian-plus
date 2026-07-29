import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { CLAUDIAN_PLUS_STORAGE_PATH } from '../../../core/bootstrap/StoragePaths';
import { buildPortableObsidianMcpScript } from '../../../core/obsidian/portableToolRuntime';
import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import { expandHomePath } from '../../../utils/path';
import {
  OPENCODE_BUILD_MODE_ID,
  OPENCODE_PLAN_MODE_ID,
  OPENCODE_SAFE_MODE_ID,
  OPENCODE_YOLO_MODE_ID,
} from '../modes';
import { resolveOpencodeDatabasePath } from './OpencodePaths';

export interface OpencodeLaunchArtifacts {
  configPath: string;
  configContent: string;
  databasePath: string | null;
  launchKey: string;
  systemPromptPath: string;
  obsidianMcpPath?: string;
}

export interface OpencodeManagedAgentConfig {
  definition?: Record<string, unknown>;
  id: string;
}

const DEFAULT_OPENCODE_MANAGED_AGENT_CONFIGS: readonly OpencodeManagedAgentConfig[] = [
  { id: OPENCODE_BUILD_MODE_ID },
  {
    definition: {
      mode: 'primary',
      permission: {
        plan_enter: 'allow',
        question: 'allow',
      },
    },
    id: OPENCODE_YOLO_MODE_ID,
  },
  {
    definition: {
      mode: 'primary',
      permission: {
        plan_enter: 'allow',
        question: 'allow',
        bash: 'ask',
        edit: 'ask',
      },
    },
    id: OPENCODE_SAFE_MODE_ID,
  },
  { id: OPENCODE_PLAN_MODE_ID },
];

export interface PrepareOpencodeLaunchArtifactsParams {
  artifactsSubdir?: string;
  defaultAgentId?: string;
  managedAgents?: readonly OpencodeManagedAgentConfig[];
  memoryAppendix?: string;
  runtimeEnv: NodeJS.ProcessEnv;
  settings?: SystemPromptSettings;
  systemPromptKey?: string;
  systemPromptText?: string;
  userName?: string;
  /** Node executable used to launch the dependency-free Obsidian MCP sidecar. */
  nodeExecutable?: string;
  /** Optional loopback bridge to the in-process Obsidian API. */
  obsidianBridge?: {
    token: string;
    url: string;
  };
  workspaceRoot: string;
}

export async function prepareOpencodeLaunchArtifacts(
  params: PrepareOpencodeLaunchArtifactsParams,
): Promise<OpencodeLaunchArtifacts> {
  const artifactsDir = path.join(
    params.workspaceRoot,
    CLAUDIAN_PLUS_STORAGE_PATH,
    params.artifactsSubdir ?? 'opencode',
  );
  const systemPromptPath = path.join(artifactsDir, 'system.md');
  const configPath = path.join(artifactsDir, 'config.json');
  const systemPrompt = normalizeSystemPrompt(
    params.systemPromptText ?? buildSystemPrompt(requireSettings(params), { memoryAppendix: params.memoryAppendix }),
  );
  const promptKey = params.systemPromptKey
    ?? (params.systemPromptText !== undefined
      ? params.systemPromptText
      : computeSystemPromptKey(requireSettings(params), { memoryAppendix: params.memoryAppendix }));
  const baseConfig = await loadOpencodeBaseConfig(
    params.runtimeEnv.OPENCODE_CONFIG,
    params.workspaceRoot,
  );
  const obsidianMcpPath = params.nodeExecutable
    ? path.join(artifactsDir, 'obsidian-mcp.cjs')
    : undefined;
  const configContent = `${JSON.stringify(
    buildOpencodeManagedConfig(
      baseConfig,
      systemPromptPath,
      params.userName ?? params.settings?.userName,
      params.managedAgents,
      params.defaultAgentId,
      obsidianMcpPath && params.nodeExecutable
        ? {
          nodeExecutable: params.nodeExecutable,
          scriptPath: obsidianMcpPath,
          workspaceRoot: params.workspaceRoot,
          obsidianBridge: params.obsidianBridge,
        }
        : undefined,
    ),
    null,
    2,
  )}\n`;
  const databasePath = resolveOpencodeDatabasePath(params.runtimeEnv);

  await fs.mkdir(artifactsDir, { recursive: true });
  await ensureOpencodeDatabaseDirectory(databasePath);
  if (obsidianMcpPath) {
    await writeIfChanged(obsidianMcpPath, buildPortableObsidianMcpScript());
  }
  await writeIfChanged(systemPromptPath, systemPrompt);
  await writeIfChanged(configPath, configContent);

  return {
    configPath,
    configContent,
    databasePath,
    launchKey: [
      promptKey,
      configContent,
      databasePath ?? '',
      obsidianMcpPath ?? '',
      params.obsidianBridge?.url ?? '',
      params.runtimeEnv.XDG_DATA_HOME ?? '',
    ].join('::'),
    systemPromptPath,
    ...(obsidianMcpPath ? { obsidianMcpPath } : {}),
  };
}

async function ensureOpencodeDatabaseDirectory(databasePath: string | null): Promise<void> {
  if (!databasePath || databasePath === ':memory:') {
    return;
  }

  await fs.mkdir(path.dirname(databasePath), { recursive: true });
}

export function buildOpencodeManagedConfig(
  baseConfig: Record<string, unknown>,
  systemPromptPath: string,
  userName?: string,
  managedAgents: readonly OpencodeManagedAgentConfig[] = DEFAULT_OPENCODE_MANAGED_AGENT_CONFIGS,
  defaultAgentId?: string,
  portableObsidianMcp?: {
    nodeExecutable: string;
    obsidianBridge?: {
      token: string;
      url: string;
    };
    scriptPath: string;
    workspaceRoot: string;
  },
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    ...baseConfig,
    $schema: typeof baseConfig.$schema === 'string'
      ? baseConfig.$schema
      : 'https://opencode.ai/config.json',
  };
  const existingAgents = isPlainObject(baseConfig.agent)
    ? { ...baseConfig.agent }
    : {};
  const nextAgents: Record<string, unknown> = { ...existingAgents };
  const agentConfigs = managedAgents.length > 0
    ? managedAgents
    : DEFAULT_OPENCODE_MANAGED_AGENT_CONFIGS;

  for (const agentConfig of agentConfigs) {
    const existingAgentValue = existingAgents[agentConfig.id];
    const existingAgent = isPlainObject(existingAgentValue)
      ? { ...existingAgentValue }
      : {};
    nextAgents[agentConfig.id] = {
      ...existingAgent,
      ...(isPlainObject(agentConfig.definition) ? agentConfig.definition : {}),
      prompt: `{file:${systemPromptPath}}`,
    };
  }

  config.agent = nextAgents;
  const trimmedDefaultAgentId = defaultAgentId?.trim();
  if (trimmedDefaultAgentId) {
    config.default_agent = trimmedDefaultAgentId;
  }

  const trimmedUserName = userName?.trim();
  if (trimmedUserName) {
    config.username = trimmedUserName;
  }

  if (portableObsidianMcp) {
    const mcp = isPlainObject(config.mcp) ? { ...config.mcp } : {};
    const servers = isPlainObject(mcp.servers) ? { ...mcp.servers } : {};
    const existingObsidianServer = isPlainObject(servers['claudian-plus-obsidian'])
      ? servers['claudian-plus-obsidian']
      : {};
    const existingEnvironment = isPlainObject(existingObsidianServer.environment)
      ? existingObsidianServer.environment
      : {};
    servers['claudian-plus-obsidian'] = {
      ...existingObsidianServer,
      type: 'local',
      command: [portableObsidianMcp.nodeExecutable, portableObsidianMcp.scriptPath],
      environment: {
        ...existingEnvironment,
        CLAUDIAN_PLUS_VAULT_ROOT: portableObsidianMcp.workspaceRoot,
        ...(portableObsidianMcp.obsidianBridge
          ? {
            // Keep the ephemeral token out of the generated config file. OpenCode
            // resolves `{env:NAME}` when launching the local MCP process.
            CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_URL: '{env:CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_URL}',
            CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_TOKEN: '{env:CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_TOKEN}',
          }
          : {}),
      },
      codemode: false,
    };
    config.mcp = { ...mcp, servers };

    const permission = isPlainObject(config.permission) ? { ...config.permission } : {};
    // OpenCode keeps hyphens when normalizing MCP server names, so these keys
    // match `claudian-plus-obsidian_<tool>` exactly.
    permission['claudian-plus-obsidian_canvas_write'] = 'ask';
    permission['claudian-plus-obsidian_properties_set'] = 'ask';
    config.permission = permission;
  }

  return config;
}

async function writeIfChanged(filePath: string, content: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    if (existing === content) {
      return;
    }
  } catch {
    // Missing file; write below.
  }

  await fs.writeFile(filePath, content, 'utf-8');
}

async function loadOpencodeBaseConfig(
  configuredPath: string | undefined,
  workspaceRoot: string,
): Promise<Record<string, unknown>> {
  const trimmedPath = configuredPath?.trim();
  if (!trimmedPath) {
    return {};
  }

  const expandedPath = expandHomePath(trimmedPath);
  const resolvedPath = path.isAbsolute(expandedPath)
    ? expandedPath
    : path.resolve(workspaceRoot, expandedPath);

  try {
    const rawConfig = await fs.readFile(resolvedPath, 'utf8');
    const parsedConfig = JSON.parse(rawConfig) as unknown;
    return isPlainObject(parsedConfig) ? parsedConfig : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSystemPrompt(systemPrompt: string): string {
  return systemPrompt.endsWith('\n') ? systemPrompt : `${systemPrompt}\n`;
}

function requireSettings(
  params: PrepareOpencodeLaunchArtifactsParams,
): SystemPromptSettings {
  if (params.settings) {
    return params.settings;
  }

  throw new Error('prepareOpencodeLaunchArtifacts requires settings when no systemPromptText is provided');
}
