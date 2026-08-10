import { type ChildProcess,spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CLAUDIAN_PLUS_STORAGE_PATH } from '../../../core/bootstrap/StoragePaths';
import { buildPortableObsidianHttpMcpScript } from '../../../core/obsidian/portableToolRuntime';
import type { AcpMcpServer } from '../../acp';

export interface PrepareKimiLaunchArtifactsParams {
  /** Node executable used to launch the dependency-free Obsidian HTTP MCP sidecar. */
  nodeExecutable?: string;
  /** Optional loopback bridge to the in-process Obsidian API. */
  obsidianBridge?: {
    token: string;
    url: string;
  };
  workspaceRoot: string;
}

export interface KimiLaunchArtifacts {
  launchKey: string;
  mcpServers: AcpMcpServer[];
  dispose: () => void;
}

const SIDECAR_READY_TIMEOUT_MS = 10_000;

/**
 * Kimi ACP accepts only HTTP MCP servers in `session/new` (`mcpServers`
 * entries are pydantic-validated as HttpMcpServer; stdio entries are rejected).
 * This materializes the dependency-free Obsidian tool runtime as an HTTP MCP
 * server sidecar (same operation kernel as the OpenCode stdio sidecar) and
 * hands Kimi its `http://127.0.0.1:<port>/mcp` URL.
 */
export async function prepareKimiLaunchArtifacts(
  params: PrepareKimiLaunchArtifactsParams,
): Promise<KimiLaunchArtifacts> {
  if (!params.nodeExecutable || !params.obsidianBridge) {
    return emptyArtifacts();
  }

  const artifactsDir = path.join(params.workspaceRoot, CLAUDIAN_PLUS_STORAGE_PATH, 'kimi');
  const scriptPath = path.join(artifactsDir, 'obsidian-mcp-http.cjs');
  const scriptSource = buildPortableObsidianHttpMcpScript();
  writeIfChanged(scriptPath, scriptSource);

  const token = crypto.randomBytes(24).toString('hex');
  const debugFile = process.env.CLAUDIAN_PLUS_KIMI_MCP_DEBUG_FILE;
  const child = spawn(
    params.nodeExecutable,
    [scriptPath],
    {
      cwd: params.workspaceRoot,
      env: {
        ...process.env,
        CLAUDIAN_PLUS_OBSIDIAN_HTTP_PORT: '0',
        CLAUDIAN_PLUS_OBSIDIAN_MCP_TOKEN: token,
        CLAUDIAN_PLUS_VAULT_ROOT: params.workspaceRoot,
        CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_URL: params.obsidianBridge.url,
        CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_TOKEN: params.obsidianBridge.token,
        ...(debugFile
          ? {
            CLAUDIAN_PLUS_OBSIDIAN_MCP_DEBUG: '1',
            CLAUDIAN_PLUS_OBSIDIAN_MCP_DEBUG_FILE: debugFile,
          }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    },
  );
  const port = await waitForSidecarPort(child);
  if (!port) {
    child.kill();
    return emptyArtifacts();
  }

  const httpServer: AcpMcpServer = {
    type: 'http',
    name: 'claudian-plus-obsidian',
    url: `http://127.0.0.1:${port}/mcp`,
    headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
  };
  const mcpServers: AcpMcpServer[] = [httpServer];

  return {
    launchKey: JSON.stringify({ mcpUrl: httpServer.url, token }),
    mcpServers,
    dispose: () => {
      if (child.exitCode === null) {
        child.kill();
      }
    },
  };
}

function emptyArtifacts(): KimiLaunchArtifacts {
  return {
    launchKey: JSON.stringify({}),
    mcpServers: [],
    dispose: () => {},
  };
}

function waitForSidecarPort(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    let stdoutBuffer = '';
    const finish = (port: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('exit', onExit);
      resolve(port);
    };
    const onData = (chunk: Buffer): void => {
      stdoutBuffer += chunk.toString('utf8');
      const match = stdoutBuffer.match(/CLAUDIAN_PLUS_OBSIDIAN_MCP_READY port=(\d+)/);
      if (match) {
        finish(Number(match[1]));
      }
    };
    const onExit = (): void => {
      finish(null);
    };
    const timer = window.setTimeout(() => finish(null), SIDECAR_READY_TIMEOUT_MS);
    child.stdout?.on('data', onData);
    child.on('exit', onExit);
  });
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
