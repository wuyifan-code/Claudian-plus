import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveExistingOpencodeDatabasePath,
  resolveOpencodeDatabasePath,
  resolveOpencodeDataDir,
} from '../../../../src/providers/opencode/runtime/OpencodePaths';

describe('OpencodePaths', () => {
  it('prefers XDG data directories for OpenCode data', () => {
    expect(resolveOpencodeDataDir({
      HOME: '/home/tester',
      XDG_DATA_HOME: '/tmp/xdg-data',
    } as NodeJS.ProcessEnv)).toBe(path.join('/tmp/xdg-data', 'opencode'));
  });

  it('falls back to the existing resolved database when persisted metadata points at a missing path', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-plus-opencode-paths-'));
    const xdgDataHome = path.join(tmpRoot, 'xdg-data');
    const dbDir = path.join(xdgDataHome, 'opencode');
    const dbPath = path.join(dbDir, 'opencode.db');
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(dbPath, '');

    const env = {
      HOME: path.join(tmpRoot, 'home'),
      XDG_DATA_HOME: xdgDataHome,
    } as NodeJS.ProcessEnv;

    expect(resolveOpencodeDatabasePath(env)).toBe(dbPath);
    expect(resolveExistingOpencodeDatabasePath('/missing/opencode.db', env)).toBe(dbPath);
  });

  describe('Windows data-dir resolution', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

    afterEach(() => {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

    function forceWin32(): void {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    }

    it('resolves the CLI data dir under %USERPROFILE%\\.local\\share\\opencode', () => {
      forceWin32();
      const home = 'C:\\Users\\tester';
      expect(resolveOpencodeDataDir({ USERPROFILE: home } as NodeJS.ProcessEnv))
        .toBe(path.join(home, '.local', 'share', 'opencode'));
    });

    it('finds the existing database under ~/.local/share/opencode instead of %APPDATA%', () => {
      forceWin32();
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-plus-opencode-paths-win-'));
      const localShare = path.join(tmpRoot, 'home', '.local', 'share', 'opencode');
      const dbPath = path.join(localShare, 'opencode.db');
      fs.mkdirSync(localShare, { recursive: true });
      fs.writeFileSync(dbPath, '');

      const env = {
        USERPROFILE: path.join(tmpRoot, 'home'),
        APPDATA: path.join(tmpRoot, 'appdata'),
      } as NodeJS.ProcessEnv;

      expect(resolveOpencodeDatabasePath(env)).toBe(dbPath);
    });

    it('recovers a poisoned persisted %APPDATA% database path by falling back to the real CLI database', () => {
      forceWin32();
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-plus-opencode-paths-win-'));
      const localShare = path.join(tmpRoot, 'home', '.local', 'share', 'opencode');
      const dbPath = path.join(localShare, 'opencode.db');
      fs.mkdirSync(localShare, { recursive: true });
      fs.writeFileSync(dbPath, '');

      const env = {
        USERPROFILE: path.join(tmpRoot, 'home'),
        APPDATA: path.join(tmpRoot, 'appdata'),
      } as NodeJS.ProcessEnv;

      // Mirrors the persisted providerState recorded by earlier builds:
      // %APPDATA%\opencode\opencode.db was stored even though it never existed.
      const poisonedPath = path.join(tmpRoot, 'appdata', 'opencode', 'opencode.db');

      expect(resolveExistingOpencodeDatabasePath(poisonedPath, env)).toBe(dbPath);
    });

    it('keeps an existing %APPDATA% database reachable as a fallback', () => {
      forceWin32();
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-plus-opencode-paths-win-'));
      const appData = path.join(tmpRoot, 'home', 'AppData', 'Roaming', 'opencode');
      const dbPath = path.join(appData, 'opencode.db');
      fs.mkdirSync(appData, { recursive: true });
      fs.writeFileSync(dbPath, '');

      const env = {
        USERPROFILE: path.join(tmpRoot, 'home'),
        APPDATA: path.join(tmpRoot, 'home', 'AppData', 'Roaming'),
      } as NodeJS.ProcessEnv;

      expect(resolveOpencodeDatabasePath(env)).toBe(dbPath);
    });
  });
});
