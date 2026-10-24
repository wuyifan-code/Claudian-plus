import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ARTIFACTS, defaultTarget, syncVault } from '../../../scripts/sync-vault.js';

function makeFixture(): { repoRoot: string; target: string } {
  const base = join(tmpdir(), `claudian-sync-vault-${process.pid}-${Date.now()}`);
  const repoRoot = join(base, 'vault', '.dev', 'claudian-enhanced');
  const target = join(base, 'vault', '.obsidian', 'plugins', 'claudian-plus');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(target, { recursive: true });
  for (const name of ARTIFACTS) {
    writeFileSync(join(repoRoot, name), `new-${name}`);
  }
  writeFileSync(join(repoRoot, 'package.json'), '{}');
  writeFileSync(join(target, 'main.js'), 'old-main.js');
  writeFileSync(join(target, 'data.json'), '{"userSettings":true}');
  return { repoRoot, target };
}

describe('sync-vault', () => {
  it('copies build artifacts over the previous install', () => {
    const { repoRoot, target } = makeFixture();
    const result = syncVault({ root: repoRoot, target });
    expect(result.synced).toEqual(ARTIFACTS);
    expect(result.skipped).toBe(false);
    expect(readFileSync(join(target, 'main.js'), 'utf8')).toBe('new-main.js');
  });

  it('never touches data.json in the target folder', () => {
    const { repoRoot, target } = makeFixture();
    syncVault({ root: repoRoot, target });
    expect(readFileSync(join(target, 'data.json'), 'utf8')).toBe('{"userSettings":true}');
  });

  it('backs up existing artifacts only when backup is requested', () => {
    const { repoRoot, target } = makeFixture();
    syncVault({ root: repoRoot, target, backup: true });
    expect(readFileSync(join(target, 'main.js.bak'), 'utf8')).toBe('old-main.js');
    expect(existsSync(join(target, 'styles.css.bak'))).toBe(false);
  });

  it('skips silently when the default vault install is absent', () => {
    const base = join(tmpdir(), `claudian-sync-vault-skip-${process.pid}-${Date.now()}`);
    const repoRoot = join(base, 'other-vault', '.dev', 'claudian-enhanced');
    mkdirSync(repoRoot, { recursive: true });
    for (const name of ARTIFACTS) {
      writeFileSync(join(repoRoot, name), `new-${name}`);
    }
    const result = syncVault({ root: repoRoot });
    expect(result.synced).toEqual([]);
    expect(result.skipped).toBe(true);
  });

  it('creates the target folder when an explicit target is given', () => {
    const { repoRoot, target } = makeFixture();
    const freshTarget = join(target, '..', 'claudian-plus-other');
    const result = syncVault({ root: repoRoot, target: freshTarget });
    expect(result.skipped).toBe(false);
    expect(existsSync(join(freshTarget, 'manifest.json'))).toBe(true);
  });

  it('derives the default target two levels above the repo root', () => {
    const repoRoot = join('x', 'vault', '.dev', 'claudian-enhanced');
    expect(defaultTarget(repoRoot)).toBe(join('x', 'vault', '.obsidian', 'plugins', 'claudian-plus'));
  });
});
