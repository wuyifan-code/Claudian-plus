import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { detectCliPath, resolveCliPathInput } from '@/shared/settings/cliPathResolver';

describe('resolveCliPathInput', () => {
  it('treats an empty field as "use PATH"', () => {
    expect(resolveCliPathInput('   ', 'opencode')).toEqual({ path: null, error: null });
  });

  it('accepts a bare command name found on the enhanced PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-path-'));
    const shim = path.join(dir, process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
    fs.writeFileSync(shim, '');
    try {
      expect(resolveCliPathInput('opencode', 'opencode', dir)).toEqual({ path: shim, error: null });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a bare name that is not on PATH', () => {
    expect(resolveCliPathInput('definitely-not-a-cli', 'definitely-not-a-cli', '')).toEqual({
      path: null,
      error: 'not-found',
    });
  });

  it('accepts an absolute file path', () => {
    const file = path.join(os.tmpdir(), `cli-${Date.now()}.sh`);
    fs.writeFileSync(file, '');
    try {
      expect(resolveCliPathInput(file, 'x')).toEqual({ path: file, error: null });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('rejects a directory and a missing path', () => {
    expect(resolveCliPathInput(os.tmpdir(), 'x').error).toBe('not-a-file');
    expect(resolveCliPathInput(path.join(os.tmpdir(), 'nope-not-here'), 'x').error).toBe('not-found');
  });
});

describe('detectCliPath', () => {
  it('finds a shim on the given PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-detect-'));
    const shim = path.join(dir, process.platform === 'win32' ? 'agy.exe' : 'agy');
    fs.writeFileSync(shim, '');
    try {
      expect(detectCliPath('agy', dir)).toBe(shim);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when the binary is absent', () => {
    expect(detectCliPath('nothing-here', '')).toBeNull();
  });
});
