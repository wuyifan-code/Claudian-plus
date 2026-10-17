import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function resolveDshNodeEntry(cliPath: string): Promise<string> {
  let entry = cliPath.trim();
  if (/\.(cmd|ps1)$/i.test(entry)) {
    entry = join(dirname(entry), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  } else if (!/\.[cm]?js$/i.test(entry)) {
    throw new Error('Choose the npm dsh CLI or its JavaScript entry. Desktop installations are not supported yet.');
  }
  try { await access(entry); } catch { throw new Error('The DeepSeek Harness CLI entry was not found.'); }
  return resolve(entry);
}

export function getDshHome(env: NodeJS.ProcessEnv, cwd: string, platform: NodeJS.Platform = process.platform): string {
  if (env.DSH_HOME?.trim()) return resolve(cwd, env.DSH_HOME.trim());
  const home = platform === 'win32' ? env.USERPROFILE : env.HOME;
  return resolve(home || homedir(), '.dsh');
}

export function sameDshHome(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export interface DshLaunchArtifacts {
  patchPath: string;
  pluginPath: string;
  endpointPath: string;
  dispose(): Promise<void>;
}

export async function prepareDshLaunch(cmdlineModule: string, parent = tmpdir()): Promise<DshLaunchArtifacts> {
  const directory = await mkdtemp(join(parent, 'claudian-plus-dsh-'));
  const pluginPath = join(directory, 'bridge.mjs');
  const patchPath = join(directory, 'overlay.json');
  const endpointPath = join(directory, 'endpoint.json');
  const source = `import { writeFile } from 'node:fs/promises';
import { exitOnStdinEnd } from ${JSON.stringify(pathToFileURL(cmdlineModule).href)};
export const name = 'claudian-plus-native-bridge';
export const inject = ['webServer', 'connection'];
export function apply(ctx) {
  exitOnStdinEnd(ctx, 'claudian-plus.stdin');
  process.stdin.resume();
  const cancel = ctx.get('appReady').onReady(() => {
    const url = ctx.connection.authenticatedUrl('http://127.0.0.1:' + ctx.webServer.port + '/');
    void writeFile(${JSON.stringify(endpointPath)}, JSON.stringify({url}), {mode:0o600}).catch(() => ctx.get('appExit')(1));
  });
  ctx.effect(() => cancel, 'claudian-plus.ready');
}
`;
  try {
    await writeFile(pluginPath, source, { mode: 0o600 });
    await writeFile(patchPath, JSON.stringify([
      { id: 'session-title-llm', disabled: true },
      { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] } },
      { insert: [
        { id: 'claudian-plus-native-bridge', name: pathToFileURL(pluginPath).href },
        { id: 'claudian-plus-preset', name: '@deepseek-ai/dsh-agent-preset', config: {
          id: 'claudian-plus', name: 'Claudian Plus',
          plugins: [
            { name: '@deepseek-ai/dsh-persona', config: {
              prefix: 'You are a coding agent powered by the {{model}} model.',
              suffix: 'Your working directory is {{cwd}}.',
            } },
            { name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
            { name: process.platform === 'win32' ? '@deepseek-ai/dsh-tool-pwsh' : '@deepseek-ai/dsh-tool-bash' },
            { name: '@deepseek-ai/dsh-tool-fs' },
            { name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
          ],
        } },
      ] },
    ]), { mode: 0o600 });
    return { pluginPath, patchPath, endpointPath, dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
