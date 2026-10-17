import { mkdir, mkdtemp, readFile,rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDshHome,prepareDshLaunch, resolveDshNodeEntry } from '@/providers/dsh/runtime/DshLaunch';

describe('native DSH launch boundary', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'dsh-launch-test-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('resolves npm command shims to the owning JS entry without invoking a shell', async () => {
    const entry = join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    await mkdir(join(entry, '..'), { recursive: true });
    await writeFile(entry, '');
    expect(await resolveDshNodeEntry(join(directory, 'dsh.cmd'))).toBe(entry);
    expect(await resolveDshNodeEntry(join(directory, 'dsh.ps1'))).toBe(entry);
    expect(await resolveDshNodeEntry(entry)).toBe(entry);
  });

  it('rejects unsupported or missing executables instead of spawning them', async () => {
    await expect(resolveDshNodeEntry(join(directory, 'Desktop.exe'))).rejects.toThrow('CLI');
    await expect(resolveDshNodeEntry(join(directory, 'missing.cmd'))).rejects.toThrow('entry');
  });

  it('uses native Windows home identity and resolves relative DSH_HOME from the vault', () => {
    expect(getDshHome({ USERPROFILE: directory, HOME: '/wrong' }, directory, 'win32')).toBe(join(directory, '.dsh'));
    expect(getDshHome({ DSH_HOME: 'local' }, directory)).toBe(join(directory, 'local'));
  });

  it('writes only a temporary invocation overlay with native readiness and EOF shutdown', async () => {
    const launch = await prepareDshLaunch('/native/cmdline.js', directory);
    try {
      const overlay = JSON.parse(await readFile(launch.patchPath, 'utf8'));
      expect(overlay.find((row: { id: string }) => row.id === 'web-runtime').config).toMatchObject({ openBrowser: false, printUrl: false });
      const preset = overlay.flatMap((row: { insert?: unknown[] }) => row.insert ?? []).find((row: { id: string }) => row.id === 'claudian-plus-preset');
      expect(preset.config).toMatchObject({ id: 'claudian-plus' });
      expect(preset.config.plugins.map((row: { name: string }) => row.name)).toContain('@deepseek-ai/dsh-tool-fs');
      const source = await readFile(launch.pluginPath, 'utf8');
      expect(source).toContain('exitOnStdinEnd');
      expect(source).toContain('onReady');
      expect(source).toContain('process.stdin.resume()');
    } finally { await launch.dispose(); }
  });
});
