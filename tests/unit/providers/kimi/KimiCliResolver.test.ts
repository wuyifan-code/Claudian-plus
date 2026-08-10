import * as fs from 'fs';

import { KimiCliResolver } from '@/providers/kimi/runtime/KimiCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

jest.mock('@/utils/cliBinaryLocator', () => ({
  ...jest.requireActual('@/utils/cliBinaryLocator'),
  findCliBinaryPath: () => null,
}));

describe('KimiCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true });
  });

  it('uses the current host path instead of another synced host path', () => {
    const resolver = new KimiCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/kimi',
        'current-host': '/current/kimi',
      },
      '/legacy/kimi',
      '',
    );

    expect(resolved).toBe('/current/kimi');
  });

  it('falls back to the legacy path when the current host has no custom path', () => {
    const resolver = new KimiCliResolver();
    const resolved = resolver.resolve(
      {
        'other-host': '/other/kimi',
      },
      '/legacy/kimi',
      '',
    );

    expect(resolved).toBe('/legacy/kimi');
  });

  it('returns null when no path is configured and nothing is on PATH', () => {
    const resolver = new KimiCliResolver();
    const resolved = resolver.resolve({}, '', 'PATH=/nonexistent-dir');

    expect(resolved).toBeNull();
  });
});
