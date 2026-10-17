import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { DshSubprocess } from '@/providers/dsh/runtime/DshSubprocess';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

describe('DSH graceful process lifetime', () => {
  it('allows native EOF shutdown before any forced termination', async () => {
    const proc = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: jest.fn(),
    });
    jest.mocked(spawn).mockReturnValue(proc as never);
    const runner = new DshSubprocess({ command: 'node', args: [], cwd: '.', env: {} }, 50);
    runner.start();
    const stopping = runner.shutdown();
    expect(proc.stdin.writableEnded).toBe(true);
    expect(proc.kill).not.toHaveBeenCalled();
    proc.emit('exit', 0, null);
    proc.emit('close', 0, null);
    await stopping;
    expect(proc.kill).not.toHaveBeenCalled();
  });
});
