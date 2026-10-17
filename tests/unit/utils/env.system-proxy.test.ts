import { execSync } from 'child_process';

import { resolveSystemProxyEnvironment } from '@/utils/env';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execSync: jest.fn(),
}));

describe('Windows system proxy discovery', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    jest.clearAllMocks();
  });

  it('queries the registry without opening a console window', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    jest.mocked(execSync).mockReturnValue(
      'ProxyEnable    REG_DWORD    0x1\nProxyServer    REG_SZ    127.0.0.1:7897',
    );

    const result = resolveSystemProxyEnvironment({}, { forceRefresh: true });

    expect(result.HTTPS_PROXY).toBe('http://127.0.0.1:7897');
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('reg query'),
      expect.objectContaining({ windowsHide: true }),
    );
  });
});
