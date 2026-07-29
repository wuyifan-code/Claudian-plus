import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  OPENCODE_SAFE_MODE_ID,
  OPENCODE_YOLO_MODE_ID,
} from '../../../../src/providers/opencode/modes';
import {
  buildOpencodeManagedConfig,
  prepareOpencodeLaunchArtifacts,
} from '../../../../src/providers/opencode/runtime/OpencodeLaunchArtifacts';

describe('buildOpencodeManagedConfig', () => {
  it('pins OpenCode build, YOLO, safe, and plan prompts to the managed prompt file', () => {
    expect(buildOpencodeManagedConfig({}, '/vault/.claudian-plus/opencode/system.md', 'Yishen')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agent: {
        build: {
          prompt: '{file:/vault/.claudian-plus/opencode/system.md}',
        },
        [OPENCODE_YOLO_MODE_ID]: {
          mode: 'primary',
          permission: {
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: '{file:/vault/.claudian-plus/opencode/system.md}',
        },
        [OPENCODE_SAFE_MODE_ID]: {
          mode: 'primary',
          permission: {
            bash: 'ask',
            edit: 'ask',
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: '{file:/vault/.claudian-plus/opencode/system.md}',
        },
        plan: {
          prompt: '{file:/vault/.claudian-plus/opencode/system.md}',
        },
      },
      username: 'Yishen',
    });
  });

  it('can create a dedicated aux agent and default it for the process', () => {
    expect(buildOpencodeManagedConfig(
      {},
      '/vault/.claudian-plus/opencode/auxiliary/system.md',
      undefined,
      [{
        definition: {
          mode: 'primary',
          permission: {
            '*': 'deny',
            read: 'allow',
          },
        },
        id: 'claudian-plus-aux-readonly',
      }],
      'claudian-plus-aux-readonly',
    )).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agent: {
        'claudian-plus-aux-readonly': {
          mode: 'primary',
          permission: {
            '*': 'deny',
            read: 'allow',
          },
          prompt: '{file:/vault/.claudian-plus/opencode/auxiliary/system.md}',
        },
      },
      default_agent: 'claudian-plus-aux-readonly',
    });
  });

  it('merges the user config instead of replacing it', () => {
    expect(buildOpencodeManagedConfig({
      agent: {
        build: {
          model: 'openai/gpt-5',
          permission: {
            bash: 'ask',
            edit: 'ask',
          },
        },
      },
      default_agent: 'build',
      providers: {
        openai: {
          api_key: 'test-key',
        },
      },
      username: 'Existing',
    }, '/vault/.claudian-plus/opencode/system.md')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agent: {
        build: {
          model: 'openai/gpt-5',
          permission: {
            bash: 'ask',
            edit: 'ask',
          },
          prompt: '{file:/vault/.claudian-plus/opencode/system.md}',
        },
        [OPENCODE_YOLO_MODE_ID]: {
          mode: 'primary',
          permission: {
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: '{file:/vault/.claudian-plus/opencode/system.md}',
        },
        [OPENCODE_SAFE_MODE_ID]: {
          mode: 'primary',
          permission: {
            bash: 'ask',
            edit: 'ask',
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: '{file:/vault/.claudian-plus/opencode/system.md}',
        },
        plan: {
          prompt: '{file:/vault/.claudian-plus/opencode/system.md}',
        },
      },
      default_agent: 'build',
      providers: {
        openai: {
          api_key: 'test-key',
        },
      },
      username: 'Existing',
    });
  });

  it('adds the portable Obsidian MCP server without replacing user MCP servers', () => {
    expect(buildOpencodeManagedConfig({
      mcp: {
        servers: {
          existing: { type: 'remote', url: 'https://example.test/mcp' },
        },
      },
      permission: { read: 'allow' },
    }, '/vault/.claudian-plus/opencode/system.md', undefined, undefined, undefined, {
      nodeExecutable: 'node',
      scriptPath: '/vault/.claudian-plus/opencode/obsidian-mcp.cjs',
      workspaceRoot: '/vault',
      obsidianBridge: {
        token: 'secret-token',
        url: 'http://127.0.0.1:43210',
      },
    })).toMatchObject({
      mcp: {
        servers: {
          existing: { type: 'remote', url: 'https://example.test/mcp' },
          'claudian-plus-obsidian': {
            type: 'local',
            command: ['node', '/vault/.claudian-plus/opencode/obsidian-mcp.cjs'],
            environment: {
              CLAUDIAN_PLUS_VAULT_ROOT: '/vault',
              CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_URL: '{env:CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_URL}',
              CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_TOKEN: '{env:CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_TOKEN}',
            },
            codemode: false,
          },
        },
      },
      permission: {
        read: 'allow',
        'claudian-plus-obsidian_canvas_write': 'ask',
        'claudian-plus-obsidian_properties_set': 'ask',
      },
    });
    expect(JSON.stringify(buildOpencodeManagedConfig({}, '/vault/.claudian-plus/opencode/system.md', undefined, undefined, undefined, {
      nodeExecutable: 'node',
      scriptPath: '/vault/.claudian-plus/opencode/obsidian-mcp.cjs',
      workspaceRoot: '/vault',
      obsidianBridge: { token: 'secret-token', url: 'http://127.0.0.1:43210' },
    }))).not.toContain('secret-token');
  });
});

describe('prepareOpencodeLaunchArtifacts', () => {
  it('layers the managed prompt config on top of OPENCODE_CONFIG', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-plus-opencode-artifacts-'));
    const baseConfigPath = path.join(tmpRoot, 'opencode.base.json');
    await fs.writeFile(baseConfigPath, JSON.stringify({
      agent: {
        build: {
          model: 'openai/gpt-5',
        },
      },
      default_agent: 'build',
      providers: {
        anthropic: {
          api_key: 'anthropic-key',
        },
      },
    }), 'utf8');

    const result = await prepareOpencodeLaunchArtifacts({
      runtimeEnv: {
        HOME: tmpRoot,
        OPENCODE_CONFIG: baseConfigPath,
      } as NodeJS.ProcessEnv,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: 'Yishen',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.configPath).toBe(path.join(tmpRoot, '.claudian-plus', 'opencode', 'config.json'));
    expect(result.systemPromptPath).toBe(path.join(tmpRoot, '.claudian-plus', 'opencode', 'system.md'));
    const generatedConfig = JSON.parse(result.configContent);
    expect(generatedConfig.agent.build.prompt).toBe(`{file:${result.systemPromptPath}}`);
    expect(JSON.parse(await fs.readFile(result.configPath, 'utf8'))).toEqual(generatedConfig);
    expect(generatedConfig).toMatchObject({
      default_agent: 'build',
      providers: {
        anthropic: {
          api_key: 'anthropic-key',
        },
      },
      username: 'Yishen',
    });
    expect(generatedConfig.agent).toMatchObject({
      build: {
        model: 'openai/gpt-5',
        prompt: `{file:${result.systemPromptPath}}`,
      },
      [OPENCODE_YOLO_MODE_ID]: {
        mode: 'primary',
        permission: {
          plan_enter: 'allow',
          question: 'allow',
        },
        prompt: `{file:${result.systemPromptPath}}`,
      },
      [OPENCODE_SAFE_MODE_ID]: {
        mode: 'primary',
        permission: {
          bash: 'ask',
          edit: 'ask',
          plan_enter: 'allow',
          question: 'allow',
        },
        prompt: `{file:${result.systemPromptPath}}`,
      },
      plan: {
        prompt: `{file:${result.systemPromptPath}}`,
      },
    });
  });

  it('keeps the launch key stable when the resolved default database is later passed as OPENCODE_DB', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-plus-opencode-artifacts-'));
    const baseParams = {
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    };
    const first = await prepareOpencodeLaunchArtifacts({
      ...baseParams,
      runtimeEnv: {
        HOME: tmpRoot,
      } as NodeJS.ProcessEnv,
    });

    const second = await prepareOpencodeLaunchArtifacts({
      ...baseParams,
      runtimeEnv: {
        HOME: tmpRoot,
        OPENCODE_DB: first.databasePath ?? undefined,
      } as NodeJS.ProcessEnv,
    });

    expect(first.databasePath).toBe(second.databasePath);
    expect(first.launchKey).toBe(second.launchKey);
  });

  it('creates the resolved OpenCode database directory before launch', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-plus-opencode-artifacts-'));
    const xdgDataHome = path.join(tmpRoot, 'xdg-data');
    const databaseDir = path.join(xdgDataHome, 'opencode');

    const result = await prepareOpencodeLaunchArtifacts({
      runtimeEnv: {
        HOME: path.join(tmpRoot, 'home'),
        XDG_DATA_HOME: xdgDataHome,
      } as NodeJS.ProcessEnv,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.databasePath).toBe(path.join(databaseDir, 'opencode.db'));
    await expect(fs.access(databaseDir)).resolves.toBeUndefined();
  });

  it('writes the portable Obsidian MCP sidecar when Node is available', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-plus-opencode-artifacts-'));
    const result = await prepareOpencodeLaunchArtifacts({
      nodeExecutable: process.execPath,
      runtimeEnv: { HOME: tmpRoot } as NodeJS.ProcessEnv,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.obsidianMcpPath).toBe(path.join(tmpRoot, '.claudian-plus', 'opencode', 'obsidian-mcp.cjs'));
    const script = await fs.readFile(result.obsidianMcpPath!, 'utf8');
    expect(script).toContain("serverInfo: { name: 'claudian-plus-obsidian'");
    expect(JSON.parse(result.configContent).mcp.servers['claudian-plus-obsidian']).toMatchObject({
      type: 'local',
      command: [process.execPath, result.obsidianMcpPath],
    });
  });
});
