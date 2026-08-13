import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { findCliBinaryPath } from '../../../utils/cliBinaryLocator';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
} from '../../../utils/windowsCmdShim';
import { resolveDshHome } from './DshModelDiscoveryService';

const DSH_PACKAGE_RANGE = '^0.1.0-rc.6';
const NPM_INSTALL_TIMEOUT_MS = 240_000;

/**
 * Dependencies a DSH ACP profile needs. Mirrors the proven acp-demo
 * composition: the acp-agent server plus the llm adapters, sandbox,
 * subprocess, approval, token-meter and compaction plugins referenced by the
 * provisioned cordis.patch.yml. dsh-llm-pi-ai/dsh-mcp-client/dsh-skill-filesystem
 * also resolve from the dsh install's module fallback, but pinning them in
 * the profile keeps the profile self-contained.
 */
const PROFILE_DEPENDENCIES: Record<string, string> = {
  '@deepseek-ai/dsh-acp-demo': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-bash-local': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-compaction-basic': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-credentials-local': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-llm-deepseek': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-llm-pi-ai': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-mcp-client': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-sandbox-local': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-sandbox-policy': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-skill-filesystem': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-subprocess-local': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-token-meter': DSH_PACKAGE_RANGE,
  '@deepseek-ai/dsh-user-approval': DSH_PACKAGE_RANGE,
};

const ACP_AGENT_PACKAGE = '@deepseek-ai/dsh-acp-demo';
const PATCH_MARKER = 'acp-agent';

export interface DshProfileProvisionOptions {
  /** Override the DSH home (defaults to `resolveDshHome()`). */
  dshHome?: string;
  /** Replace the npm install step (used by tests). */
  installDeps?: (profileDir: string) => Promise<void>;
}

export type DshProfileProvisionResult =
  | { profileDir: string; status: 'exists' | 'provisioned' }
  | { error: string; profileDir: string; status: 'error' };

let inFlightProvision: { key: string; promise: Promise<DshProfileProvisionResult> } | null = null;

function invalidProfileReason(profile: string): string | null {
  const trimmed = profile.trim();
  if (!trimmed) {
    return 'empty profile name';
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return 'profile name must not contain path separators';
  }
  if (trimmed === '.' || trimmed === '..' || trimmed === 'node_modules') {
    return 'profile name is reserved';
  }
  return null;
}

function acpAgentInstalled(profileDir: string): boolean {
  return fs.existsSync(path.join(
    profileDir,
    'node_modules',
    ACP_AGENT_PACKAGE,
    'package.json',
  ));
}

function patchComposesAcpAgent(profileDir: string): boolean {
  try {
    return fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8').includes(PATCH_MARKER);
  } catch {
    return false;
  }
}

function writeIfMissing(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) {
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function buildManifest(profile: string): string {
  const dependencies = { ...PROFILE_DEPENDENCIES };
  const manifest = {
    dependencies,
    dsh: { profile: { bundles: [] } },
    name: `dsh-profile-${profile}`,
    private: true,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function buildProfilePatch(providerRoute: string): string {
  const route = providerRoute.trim() || 'deepseek-official';
  const yamlValue = (value: string): string => `'${value.replace(/['\r\n]/g, '').trim()}'`;
  return [
    '# Auto-provisioned by Claudian Plus for the DeepSeek provider.',
    '# The launcher overlay replaces the acp-agent row config at each launch;',
    '# the llm rows register the deepseek-official and opencode-go routes.',
    '- insert:',
    '    - id: credentials',
    "      name: '@deepseek-ai/dsh-credentials-local'",
    '',
    '    - id: llm-deepseek',
    "      name: '@deepseek-ai/dsh-llm-deepseek'",
    '      config:',
    '        apiKeyEnv: DEEPSEEK_API_KEY',
    '        models:',
    '          - id: deepseek-v4-flash',
    '            name: DeepSeek V4 Flash',
    '            contextWindow: 1000000',
    '          - id: deepseek-v4-pro',
    '            name: DeepSeek V4 Pro',
    '            contextWindow: 1000000',
    '',
    '    - id: llm-pi-ai',
    "      name: '@deepseek-ai/dsh-llm-pi-ai'",
    '      config:',
    '        providers:',
    '          opencode-go:',
    '            apiKeyEnv: OPENCODE_GO_API_KEY',
    '            models:',
    '              - id: deepseek-v4-flash',
    '                name: DeepSeek V4 Flash',
    '                contextWindow: 1000000',
    '              - id: deepseek-v4-pro',
    '                name: DeepSeek V4 Pro',
    '                contextWindow: 1000000',
    '',
    '    - id: sandbox',
    "      name: '@deepseek-ai/dsh-sandbox-local'",
    '',
    '    - id: sandbox-policy',
    "      name: '@deepseek-ai/dsh-sandbox-policy'",
    '      config:',
    '        mode: workspace-write',
    '        workspaceRoot: !!js process.cwd()',
    '',
    '    - id: subprocess',
    "      name: '@deepseek-ai/dsh-subprocess-local'",
    '',
    '    - id: bash',
    // Windows: dsh-bash-sandbox wraps bash in a windows-acl runner that
    // blocks Git Bash's internal signal pipe (Win32 error 5); dsh-bash-local
    // spawns bash directly while file tools still honor the sandbox policy.
    "      name: '@deepseek-ai/dsh-bash-local'",
    '      config:',
    '        timeoutMs: 60000',
    '',
    '    - id: approval',
    "      name: '@deepseek-ai/dsh-user-approval'",
    '      config:',
    '        policy: ask',
    '',
    '    - id: acp-agent',
    "      name: '@deepseek-ai/dsh-acp-demo'",
    '      config:',
    `        provider: ${yamlValue(route)}`,
    '        model: deepseek-v4-flash',
    "        persistenceRoot: './.sessions'",
    '        workspaceContext:',
    '          maxBytes: 65536',
    '        persona: >-',
    '          You are a coding assistant powered by the {{model}} model. Your working directory is {{cwd}}.',
    '          Verify your work by running the code or tests. Keep answers brief and factual.',
    '',
    '    - id: token-meter',
    "      name: '@deepseek-ai/dsh-token-meter'",
    '',
    '    - id: compaction-basic',
    "      name: '@deepseek-ai/dsh-compaction-basic'",
    '      config:',
    '        thresholdRatio: 0.8',
    '        retainRatio: 0.08',
    '        maxTokens: 8192',
    '        compactionRetries: 1',
    '',
  ].join('\n');
}

async function runNpmInstall(profileDir: string): Promise<void> {
  const npmPath = findCliBinaryPath('npm');
  if (!npmPath) {
    throw new Error(
      'The `npm` CLI was not found on PATH. Install the profile dependencies manually by running `npm install` in '
      + profileDir,
    );
  }

  const spec = resolveWindowsCmdShimSpawnSpec({
    args: ['install', '--no-audit', '--no-fund', '--loglevel=error'],
    command: npmPath,
  });
  const child = spawn(spec.command, spec.args, {
    cwd: profileDir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  }) as unknown as ChildProcessWithoutNullStreams;

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdout = `${stdout}${Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk)}`;
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr = `${stderr}${Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk)}`;
  });

  const output = () => [stdout, stderr].filter(Boolean).join('\n').trim();
  const settled = new Promise<void>((resolve, reject) => {
    const killTimer = window.setTimeout(() => {
      terminateSpawnedProcess(child, 'SIGKILL', spawn, spec);
      reject(new Error(`npm install timed out after ${NPM_INSTALL_TIMEOUT_MS / 1000}s`));
    }, NPM_INSTALL_TIMEOUT_MS);
    child.on('error', (error) => {
      window.clearTimeout(killTimer);
      reject(error);
    });
    child.on('close', (code) => {
      window.clearTimeout(killTimer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${String(code)}`));
      }
    });
  });

  try {
    await settled;
  } catch (error) {
    const detail = output();
    throw new Error(
      `Failed to install the DSH profile dependencies in ${profileDir}.${
        detail ? `\n\n${detail}` : ''
      }\n\n${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}

/**
 * Ensure a DSH profile exists under `$DSH_HOME/profiles/<name>` with the
 * acp-agent composition installed. A missing profile is created (manifest +
 * empty root + cordis.patch.yml) and its npm dependencies are installed once.
 * Existing profiles are never mutated: a profile that already has acp-agent
 * installed and composed is left alone; a profile that exists but does not
 * compose acp-agent returns an error instead of overwriting user config.
 */
export async function ensureDshProfile(
  profile: string,
  providerRoute: string,
  options: DshProfileProvisionOptions = {},
): Promise<DshProfileProvisionResult> {
  const key = `${options.dshHome ?? ''}::${profile.trim()}`;
  if (inFlightProvision?.key === key) {
    return inFlightProvision.promise;
  }
  const run = provisionDshProfile(profile, providerRoute, options).finally(() => {
    if (inFlightProvision?.key === key) {
      inFlightProvision = null;
    }
  });
  inFlightProvision = { key, promise: run };
  return run;
}

async function provisionDshProfile(
  profile: string,
  providerRoute: string,
  options: DshProfileProvisionOptions,
): Promise<DshProfileProvisionResult> {
  const dshHome = options.dshHome ?? resolveDshHome();
  if (!dshHome) {
    return {
      error: 'Could not resolve the DSH home directory ($DSH_HOME or ~/.dsh).',
      profileDir: '',
      status: 'error',
    };
  }

  const invalidReason = invalidProfileReason(profile);
  if (invalidReason) {
    return {
      error: `Invalid DSH profile name "${profile}": ${invalidReason}.`,
      profileDir: '',
      status: 'error',
    };
  }

  const profileDir = path.join(dshHome, 'profiles', profile.trim());
  const installDeps = options.installDeps ?? runNpmInstall;

  if (acpAgentInstalled(profileDir) && patchComposesAcpAgent(profileDir)) {
    return { profileDir, status: 'exists' };
  }

  if (!patchComposesAcpAgent(profileDir)) {
    if (fs.existsSync(path.join(profileDir, 'cordis.patch.yml'))) {
      return {
        error: `DSH profile "${profile}" exists but does not compose the acp-agent stack.`
          + ' Use a different profile name or add the acp-agent composition to its cordis.patch.yml.',
        profileDir,
        status: 'error',
      };
    }
    writeIfMissing(path.join(profileDir, 'package.json'), buildManifest(profile.trim()));
    writeIfMissing(path.join(profileDir, 'cordis.yml'), '[]\n');
    writeIfMissing(path.join(profileDir, 'cordis.patch.yml'), buildProfilePatch(providerRoute));
  }

  if (!acpAgentInstalled(profileDir)) {
    try {
      await installDeps(profileDir);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        profileDir,
        status: 'error',
      };
    }
  }

  if (!acpAgentInstalled(profileDir)) {
    return {
      error: `Profile dependencies were installed in ${profileDir} but ${ACP_AGENT_PACKAGE} is still missing.`,
      profileDir,
      status: 'error',
    };
  }

  return { profileDir, status: 'provisioned' };
}
