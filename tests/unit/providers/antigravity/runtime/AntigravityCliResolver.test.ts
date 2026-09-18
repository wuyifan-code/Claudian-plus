import * as fs from 'fs';
import * as path from 'path';

import {
  ANTIGRAVITY_BINARY_NAME,
  ANTIGRAVITY_PROVIDER_ID,
  AntigravityCliResolver,
  extractAntigravityCliSettings,
} from '@/providers/antigravity/runtime/AntigravityCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedStat = fs.statSync as jest.Mock;

function mockOnlyExistingFile(existingPath: string): void {
  mockedStat.mockImplementation((filePath: string) => {
    if (filePath === existingPath) {
      return { isFile: () => true };
    }
    throw new Error(`ENOENT: ${filePath}`);
  });
}

describe('AntigravityCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  it('exposes the pinned provider id and binary name', () => {
    expect(ANTIGRAVITY_PROVIDER_ID).toBe('antigravity');
    expect(ANTIGRAVITY_BINARY_NAME).toBe('agy');
  });

  it('resolves the current host path before the legacy CLI path', () => {
    mockOnlyExistingFile('/current/agy');

    const resolver = new AntigravityCliResolver();

    expect(resolver.resolve({
      'current-host': '/current/agy',
      'other-host': '/other/agy',
    }, '/legacy/agy')).toBe('/current/agy');
  });

  it('falls back to the legacy cliPath and returns null when nothing exists', () => {
    mockOnlyExistingFile('/legacy/agy');

    const resolver = new AntigravityCliResolver();
    expect(resolver.resolve({ 'other-host': '/other/agy' }, '/legacy/agy')).toBe('/legacy/agy');

    mockedStat.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(resolver.resolve({ 'other-host': '/other/agy' }, '/legacy/agy')).toBeNull();
  });

  it('falls back to a PATH lookup for the agy binary when no path is configured', () => {
    const pathDir = '/custom/bin';
    const pathBinary = path.join(pathDir, 'agy');
    mockOnlyExistingFile(pathBinary);

    const resolver = new AntigravityCliResolver();

    expect(resolver.resolve({}, '', `PATH=${pathDir}`)).toBe(pathBinary);
  });

  it('resolves from the antigravity provider settings projection with memoization', () => {
    mockOnlyExistingFile('/current/agy');

    const resolver = new AntigravityCliResolver();
    const settings = {
      providerConfigs: {
        antigravity: {
          cliPathsByHost: {
            'current-host': '/current/agy',
          },
          environmentVariables: 'AGY_TEST=0',
        },
      },
    };

    expect(resolver.resolveFromSettings(settings)).toBe('/current/agy');
    expect(resolver.resolveFromSettings(settings)).toBe('/current/agy');
    expect(mockedStat).toHaveBeenCalledTimes(1);
  });

  it('re-resolves when the provider environment text changes', () => {
    mockOnlyExistingFile('/current/agy');

    const resolver = new AntigravityCliResolver();
    const firstSettings = {
      providerConfigs: {
        antigravity: {
          cliPathsByHost: { 'current-host': '/current/agy' },
          environmentVariables: 'AGY_TEST=0',
        },
      },
    };
    const secondSettings = {
      providerConfigs: {
        antigravity: {
          cliPathsByHost: { 'current-host': '/current/agy' },
          environmentVariables: 'AGY_TEST=1',
        },
      },
    };

    expect(resolver.resolveFromSettings(firstSettings)).toBe('/current/agy');
    expect(resolver.resolveFromSettings(secondSettings)).toBe('/current/agy');
    expect(mockedStat).toHaveBeenCalledTimes(2);
  });

  it('reset() drops the memoized resolution', () => {
    mockOnlyExistingFile('/current/agy');

    const resolver = new AntigravityCliResolver();
    const settings = {
      providerConfigs: {
        antigravity: {
          cliPathsByHost: { 'current-host': '/current/agy' },
        },
      },
    };

    expect(resolver.resolveFromSettings(settings)).toBe('/current/agy');
    resolver.reset();
    expect(resolver.resolveFromSettings(settings)).toBe('/current/agy');
    expect(mockedStat).toHaveBeenCalledTimes(2);
  });

  it('extractAntigravityCliSettings tolerates malformed settings', () => {
    expect(extractAntigravityCliSettings({})).toEqual({ cliPath: '', cliPathsByHost: {} });
    expect(extractAntigravityCliSettings({
      providerConfigs: {
        antigravity: {
          cliPath: ' C:\\agy\\agy.EXE ',
          cliPathsByHost: 'not-a-record',
          ignored: 'value',
        },
      },
    })).toEqual({ cliPath: ' C:\\agy\\agy.EXE ', cliPathsByHost: {} });
    expect(extractAntigravityCliSettings({
      providerConfigs: {
        antigravity: {
          cliPath: 42,
          cliPathsByHost: { 'host-a': '/agy', 'host-b': '   ' },
        },
      },
    })).toEqual({ cliPath: '', cliPathsByHost: { 'host-a': '/agy' } });
  });
});
