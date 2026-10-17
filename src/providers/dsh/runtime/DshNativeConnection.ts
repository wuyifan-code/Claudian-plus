import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { findNodeExecutable, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { DshRemoteClient } from '../remote/DshRemoteClient';
import { getDshProviderSettings } from '../settings';
import type { DshNativeConnection } from './DshHost';
import { getDshHome, prepareDshLaunch, resolveDshNodeEntry } from './DshLaunch';
import { DshSubprocess } from './DshSubprocess';

export async function authenticateDshEndpoint(endpoint: string, signal?: AbortSignal): Promise<{ origin: string; cookie: string }> {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('DeepSeek Harness requires a loopback endpoint.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/') {
    throw new Error('DeepSeek Harness requires a loopback endpoint.');
  }
  if (signal?.aborted) throw new Error('DeepSeek Harness authentication cancelled.');
  return new Promise((resolve, reject) => {
    const req = request(url, { signal, agent: false }, res => {
      res.resume();
      const cookies = res.headers['set-cookie'];
      if (res.statusCode !== 303 || !cookies?.length) {
        reject(new Error('DeepSeek Harness native authentication failed.'));
        return;
      }
      resolve({ origin: url.origin, cookie: cookies.map(cookie => cookie.split(';')[0]).join('; ') });
    });
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', () => reject(new Error(signal?.aborted ? 'DeepSeek Harness authentication cancelled.' : 'DeepSeek Harness native authentication failed.')));
    req.end();
  });
}

export async function createNativeDshConnection(plugin: ProviderHost, signal?: AbortSignal): Promise<DshNativeConnection> {
  const settings = getDshProviderSettings(plugin.settings);
  if (!settings.enabled) throw new Error('Enable DeepSeek Harness before starting its native runtime.');
  const cwd = getVaultPath(plugin.app);
  if (!cwd) throw new Error('DeepSeek Harness requires a local vault.');
  const cli = await plugin.getResolvedProviderCliPath('dsh');
  if (!cli) throw new Error('Install the npm DeepSeek Harness CLI and choose its path in settings.');
  const entry = await resolveDshNodeEntry(cli);
  const env = { ...process.env, ...parseEnvironmentVariables(plugin.getActiveEnvironmentVariables('dsh')) };
  const node = findNodeExecutable(env.PATH);
  if (!node) throw new Error('DeepSeek Harness requires Node.js on PATH.');
  let cmdline: string;
  try { cmdline = createRequire(entry).resolve('@deepseek-ai/dsh-cmdline'); } catch {
    throw new Error('This DeepSeek Harness installation does not expose the supported native Web runtime.');
  }
  if (signal?.aborted) throw new Error('DeepSeek Harness startup cancelled.');
  const artifacts = await prepareDshLaunch(cmdline);
  const runner = new DshSubprocess({ command: node,
    args: [entry, '--profile', 'web', '--patch', artifacts.patchPath, '--no-open', '--port', '0'], cwd, env });
  let client: DshRemoteClient | undefined;
  let closing: Promise<void> | undefined;
  const dispose = () => closing ??= (async () => {
    client?.dispose();
    await runner.shutdown();
    await artifacts.dispose();
  })();
  try {
    runner.start();
    runner.stdout.resume();
    const deadline = Date.now() + settings.startupTimeoutMs;
    let endpoint: string | undefined;
    while (Date.now() < deadline && !signal?.aborted) {
      if (!runner.isAlive()) throw new Error('DeepSeek Harness exited during startup. Check its CLI installation and native configuration.');
      try {
        const raw: unknown = JSON.parse(await readFile(artifacts.endpointPath, 'utf8'));
        if (raw && typeof raw === 'object' && 'url' in raw && typeof raw.url === 'string') { endpoint = raw.url; break; }
      } catch { /* The bridge publishes the endpoint after native initialization. */ }
      await delay(100, undefined, { signal });
    }
    if (signal?.aborted) throw new Error('DeepSeek Harness startup cancelled.');
    if (!endpoint) throw new Error('DeepSeek Harness startup timed out. Check the CLI version or increase the startup timeout.');
    const auth = await authenticateDshEndpoint(endpoint, signal);
    client = new DshRemoteClient(auth.origin, auth.cookie);
    await client.connect(signal);
    const activeClient = client;
    runner.onClose(() => activeClient.dispose());
    return { client, home: getDshHome(env, cwd), dispose };
  } catch (error) {
    await dispose();
    if (signal?.aborted) throw new Error('DeepSeek Harness startup cancelled.', { cause: error });
    throw error;
  }
}
