import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { prepareDshLaunchArtifacts } from '@/providers/dsh/runtime/DshLaunchArtifacts';

describe('prepareDshLaunchArtifacts', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-launch-'));
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { force: true, recursive: true });
  });

  it('writes an acp-agent overlay that pins provider route and model', async () => {
    const artifacts = await prepareDshLaunchArtifacts({
      model: 'deepseek-v4-pro',
      profile: 'acp',
      providerRoute: 'deepseek-official',
      workspaceRoot,
    });

    expect(JSON.parse(artifacts.launchKey)).toMatchObject({
      model: 'deepseek-v4-pro',
      profile: 'acp',
      providerRoute: 'deepseek-official',
      mcpServers: [],
      skillDirs: [],
    });
    const overlay = fs.readFileSync(artifacts.patchPath, 'utf8');
    expect(overlay).toContain('- id: acp-agent');
    expect(overlay).toContain("provider: 'deepseek-official'");
    expect(overlay).toContain("model: 'deepseek-v4-pro'");
    // The Loader replaces the whole row config, so required fields must be present.
    expect(overlay).toContain("persistenceRoot: './.sessions'");
    expect(overlay).toContain('workspaceContext:');
  });

  it('pins reasoning effort into the llm-deepseek row for the official route', async () => {
    const artifacts = await prepareDshLaunchArtifacts({
      llmModels: [
        { contextWindow: 1000000, id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      ],
      model: 'deepseek-v4-pro',
      profile: 'acp',
      providerRoute: 'deepseek-official',
      reasoningEffort: 'max',
      workspaceRoot,
    });

    expect(JSON.parse(artifacts.launchKey)).toMatchObject({ reasoningEffort: 'max' });
    const overlay = fs.readFileSync(artifacts.patchPath, 'utf8');
    expect(overlay).toContain('- id: llm-deepseek');
    expect(overlay).toContain('thinking: enabled');
    expect(overlay).toContain("reasoningEffort: 'max'");
    expect(overlay).toContain("apiKeyEnv: 'DEEPSEEK_API_KEY'");
    expect(overlay).toContain("- id: 'deepseek-v4-flash'");
  });

  it('disables thinking when reasoning effort is off', async () => {
    const artifacts = await prepareDshLaunchArtifacts({
      model: 'deepseek-v4-pro',
      profile: 'acp',
      providerRoute: 'deepseek-official',
      reasoningEffort: 'off',
      workspaceRoot,
    });

    const overlay = fs.readFileSync(artifacts.patchPath, 'utf8');
    expect(overlay).toContain('- id: llm-deepseek');
    expect(overlay).toContain('thinking: disabled');
    expect(overlay).not.toContain('reasoningEffort:');
  });

  it('does not pin reasoning for non-deepseek routes', async () => {
    const artifacts = await prepareDshLaunchArtifacts({
      model: 'deepseek-v4-pro',
      profile: 'acp',
      providerRoute: 'opencode-go',
      reasoningEffort: 'max',
      workspaceRoot,
    });

    const overlay = fs.readFileSync(artifacts.patchPath, 'utf8');
    expect(overlay).not.toContain('llm-deepseek');
    expect(overlay).not.toContain('reasoningEffort:');
  });

  it('sanitizes quotes and newlines from configured values', async () => {
    const artifacts = await prepareDshLaunchArtifacts({
      model: "deepseek-v4-flash'\n",
      profile: 'acp',
      providerRoute: 'deepseek-official',
      workspaceRoot,
    });

    const overlay = fs.readFileSync(artifacts.patchPath, 'utf8');
    expect(overlay).toContain("model: 'deepseek-v4-flash'");
    expect(overlay).not.toContain('\n\n');
  });

  it('keeps the patch path under the managed claudian-plus storage dir', async () => {
    const artifacts = await prepareDshLaunchArtifacts({
      model: 'deepseek-v4-flash',
      profile: 'acp',
      providerRoute: 'deepseek-official',
      workspaceRoot,
    });

    expect(path.dirname(artifacts.patchPath)).toBe(
      path.join(workspaceRoot, '.claudian-plus', 'dsh'),
    );
  });

  it('injects skill roots into the acp-agent skills config', async () => {
    const artifacts = await prepareDshLaunchArtifacts({
      model: 'deepseek-v4-flash',
      profile: 'acp',
      providerRoute: 'deepseek-official',
      skillDirs: ['C:\\vault\\.claude\\skills', 'C:\\vault\\.codex\\skills'],
      workspaceRoot,
    });

    const overlay = fs.readFileSync(artifacts.patchPath, 'utf8');
    expect(overlay).toContain('skills:');
    expect(overlay).toContain('customSkillDirs:');
    expect(overlay).toContain("'C:\\vault\\.claude\\skills'");
    expect(overlay).toContain("'C:\\vault\\.codex\\skills'");
    expect(artifacts.launchKey).toContain('skillDirs');
  });

  it('injects enabled MCP servers as dsh-mcp-client rows', async () => {
    const artifacts = await prepareDshLaunchArtifacts({
      mcpServers: [
        {
          name: 'github',
          enabled: true,
          contextSaving: true,
          config: { type: 'stdio', command: 'npx', args: ['-y', 'server-github'] },
        },
        {
          name: 'web',
          enabled: true,
          contextSaving: true,
          config: { type: 'http', url: 'http://localhost:3000/mcp', headers: { Authorization: 'Bearer x' } },
        },
        {
          name: 'disabled-srv',
          enabled: false,
          contextSaving: true,
          config: { type: 'stdio', command: 'nope' },
        },
      ],
      model: 'deepseek-v4-flash',
      profile: 'acp',
      providerRoute: 'deepseek-official',
      workspaceRoot,
    });

    const overlay = fs.readFileSync(artifacts.patchPath, 'utf8');
    expect(overlay).toContain('- insert:');
    expect(overlay).toContain('mcp-github');
    expect(overlay).toContain('transport: stdio');
    expect(overlay).toContain('mcp-web');
    expect(overlay).toContain('transport: streamable-http');
    expect(overlay).not.toContain('mcp-disabled-srv');
  });

  it('skips MCP servers with invalid names or sse transport', async () => {
    const artifacts = await prepareDshLaunchArtifacts({
      mcpServers: [
        {
          name: 'bad name!',
          enabled: true,
          contextSaving: true,
          config: { type: 'stdio', command: 'npx' },
        },
        {
          name: 'events',
          enabled: true,
          contextSaving: true,
          config: { type: 'sse', url: 'http://localhost:4000/sse' },
        },
      ],
      model: 'deepseek-v4-flash',
      profile: 'acp',
      providerRoute: 'deepseek-official',
      workspaceRoot,
    });

    const overlay = fs.readFileSync(artifacts.patchPath, 'utf8');
    expect(overlay).not.toContain('- insert:');
  });
});
