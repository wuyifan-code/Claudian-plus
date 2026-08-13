import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ensureDshProfile } from '@/providers/dsh/app/DshProfileProvisioner';

describe('ensureDshProfile', () => {
  let dshHome: string;

  beforeEach(() => {
    dshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  });

  afterEach(() => {
    fs.rmSync(dshHome, { force: true, recursive: true });
  });

  function markAcpAgentInstalled(profile: string): void {
    const dir = path.join(dshHome, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh-acp-demo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  }

  function writePatch(profile: string, content: string): void {
    const dir = path.join(dshHome, 'profiles', profile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), content);
  }

  function expectError(result: { status: string; error?: string }): asserts result is { error: string; status: 'error' } {
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
  }

  it('returns exists without installing when the profile is complete', async () => {
    markAcpAgentInstalled('acp');
    writePatch('acp', '- id: acp-agent\n');
    const installDeps = jest.fn(async () => {});

    const result = await ensureDshProfile('acp', 'deepseek-official', { dshHome, installDeps });

    expect(result.status).toBe('exists');
    expect(installDeps).not.toHaveBeenCalled();
  });

  it('provisions a missing profile: manifest, root, patch, then installs deps', async () => {
    const installDeps = jest.fn(async () => {
      markAcpAgentInstalled('acp');
    });

    const result = await ensureDshProfile('acp', 'deepseek-official', { dshHome, installDeps });

    expect(result.status).toBe('provisioned');
    expect(installDeps).toHaveBeenCalledTimes(1);

    const profileDir = path.join(dshHome, 'profiles', 'acp');
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    expect(manifest.name).toBe('dsh-profile-acp');
    expect(manifest.dsh.profile.bundles).toEqual([]);
    expect(manifest.dependencies['@deepseek-ai/dsh-acp-demo']).toBeTruthy();

    expect(fs.readFileSync(path.join(profileDir, 'cordis.yml'), 'utf8')).toBe('[]\n');
    const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
    expect(patch).toContain("name: '@deepseek-ai/dsh-acp-demo'");
    expect(patch).toContain("name: '@deepseek-ai/dsh-llm-deepseek'");
    expect(patch).toContain("provider: 'deepseek-official'");
    // Windows: bash must run unsandboxed (dsh-bash-sandbox's windows-acl
    // runner rejects Git Bash's signal pipe with Win32 error 5).
    expect(patch).toContain("name: '@deepseek-ai/dsh-bash-local'");
    expect(patch).not.toContain('dsh-bash-sandbox');
    expect(manifest.dependencies['@deepseek-ai/dsh-bash-local']).toBeTruthy();
  });

  it('installs deps when the patch composes acp-agent but the package is missing', async () => {
    writePatch('acp', '- id: acp-agent\n');
    const installDeps = jest.fn(async () => {
      markAcpAgentInstalled('acp');
    });

    const result = await ensureDshProfile('acp', 'deepseek-official', { dshHome, installDeps });

    expect(result.status).toBe('provisioned');
    expect(installDeps).toHaveBeenCalledTimes(1);
  });

  it('returns an error for a profile that exists but does not compose acp-agent', async () => {
    const dir = path.join(dshHome, 'profiles', 'web');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    writePatch('web', '[]\n');
    const installDeps = jest.fn(async () => {});

    const result = await ensureDshProfile('web', 'deepseek-official', { dshHome, installDeps });

    expectError(result);
    expect(result.error).toContain('acp-agent');
    expect(installDeps).not.toHaveBeenCalled();
  });

  it('surfaces install failures', async () => {
    const installDeps = jest.fn(async () => {
      throw new Error('npm install exited with code 1');
    });

    const result = await ensureDshProfile('acp', 'deepseek-official', { dshHome, installDeps });

    expectError(result);
    expect(result.error).toContain('npm install exited with code 1');
  });

  it('rejects invalid profile names', async () => {
    for (const profile of ['', '..', '.', 'node_modules', 'a/b', 'a\\b']) {
      const result = await ensureDshProfile(profile, 'deepseek-official', { dshHome });
      expect(result.status).toBe('error');
    }
  });

  it('errors when no DSH home can be resolved', async () => {
    const result = await ensureDshProfile('acp', 'deepseek-official', {
      dshHome: '',
      installDeps: jest.fn(async () => {}),
    });

    expectError(result);
    expect(result.error).toContain('DSH home');
  });

  it('writes the provider route into the acp-agent row', async () => {
    const installDeps = jest.fn(async () => {
      markAcpAgentInstalled('acp');
    });

    await ensureDshProfile('acp', 'opencode-go', { dshHome, installDeps });

    const patch = fs.readFileSync(path.join(dshHome, 'profiles', 'acp', 'cordis.patch.yml'), 'utf8');
    expect(patch).toContain("provider: 'opencode-go'");
  });
});
