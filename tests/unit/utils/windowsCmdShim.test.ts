import { terminateSpawnedProcess } from '@/utils/windowsCmdShim';

describe('terminateSpawnedProcess', () => {
  it('does not throw when a child exits before its kill signal arrives', () => {
    const proc = {
      kill: jest.fn(() => {
        throw Object.assign(new Error('already exited'), { code: 'EINVAL' });
      }),
      pid: 123,
    };

    expect(terminateSpawnedProcess(proc, 'SIGTERM', jest.fn())).toBe(false);
  });
});
