import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'node:child_process';

import {
  AntigravityCliMissingError,
  AntigravityLaunchSpecError,
} from '@/providers/antigravity/runtime/AntigravityLaunchSpec';
import { AntigravitySubprocess } from '@/providers/antigravity/runtime/AntigravitySubprocess';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockProcess(): any {
  const proc = new EventEmitter() as any;
  proc.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.exitCode = null;
  proc.killed = false;
  proc.pid = 12345;
  proc.kill = jest.fn(() => true);
  return proc;
}

const baseLaunchSpec = {
  args: ['-p', 'Reply with exactly READY.', '--output-format', 'stream-json', '--print-timeout', '30s'],
  command: 'C:\\Users\\user\\AppData\\Local\\agy\\bin\\agy.EXE',
  cwd: 'D:\\Vault',
  env: { PATH: 'C:\\Windows\\System32' } as NodeJS.ProcessEnv,
};

describe('AntigravitySubprocess', () => {
  let proc: any;

  beforeEach(() => {
    jest.clearAllMocks();
    proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
  });

  it('spawns agy with the launch spec args, cwd, stdio, windowsHide, and enhanced PATH', () => {
    const subprocess = new AntigravitySubprocess(baseLaunchSpec);
    subprocess.start();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      baseLaunchSpec.command,
      baseLaunchSpec.args,
      expect.objectContaining({
        cwd: baseLaunchSpec.cwd,
        stdio: 'pipe',
        windowsHide: true,
        env: expect.objectContaining({
          PATH: expect.stringContaining('C:\\Windows\\System32'),
        }),
      }),
    );
  });

  it('refuses to spawn with a forbidden flag in the arguments', () => {
    expect(() => new AntigravitySubprocess({
      ...baseLaunchSpec,
      args: [...baseLaunchSpec.args, '--dangerously-skip-permissions'],
    })).toThrow(AntigravityLaunchSpecError);
    expect(() => new AntigravitySubprocess({
      ...baseLaunchSpec,
      args: [...baseLaunchSpec.args, '--continue'],
    })).toThrow(AntigravityLaunchSpecError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('refuses to spawn with an unresolved CLI command', () => {
    expect(() => new AntigravitySubprocess({
      ...baseLaunchSpec,
      command: '',
    })).toThrow(AntigravityCliMissingError);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('keeps a bounded stderr snapshot for runtime diagnostics', () => {
    const subprocess = new AntigravitySubprocess(baseLaunchSpec);
    subprocess.start();

    proc.stderr.emit('data', 'a'.repeat(9_000));

    expect(subprocess.getStderrSnapshot()).toHaveLength(8_000);
  });

  it('notifies close listeners when the turn process exits', () => {
    const subprocess = new AntigravitySubprocess(baseLaunchSpec);
    const onClose = jest.fn();
    subprocess.onClose(onClose);
    subprocess.start();

    proc.emit('exit', 1, null);

    expect(onClose).toHaveBeenCalledWith(expect.any(Error));
    expect((onClose.mock.calls[0][0] as Error).message).toContain('Antigravity');
  });
});
