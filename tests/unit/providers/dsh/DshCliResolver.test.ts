import * as fs from 'fs';

import { DshCliResolver } from '@/providers/dsh/runtime/DshCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

jest.mock('@/utils/cliBinaryLocator', () => ({
  ...jest.requireActual('@/utils/cliBinaryLocator'),
  findCliBinaryPath: () => null,
}));

describe('DshCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true });
  });

  it('uses the current host path instead of another synced host path', () => {
    const resolver = new DshCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/dsh',
        'current-host': '/current/dsh',
      },
      '/legacy/dsh',
      '',
    );

    expect(resolved).toBe('/current/dsh');
  });

  it('falls back to the legacy path when the current host has no custom path', () => {
    const resolver = new DshCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/dsh',
      },
      '/legacy/dsh',
      '',
    );

    expect(resolved).toBe('/legacy/dsh');
  });

  it('returns null when no path is configured and nothing is on PATH', () => {
    const resolver = new DshCliResolver();
    const resolved = resolver.resolve({}, '', 'PATH=/nonexistent-dir');

    expect(resolved).toBeNull();
  });
});
