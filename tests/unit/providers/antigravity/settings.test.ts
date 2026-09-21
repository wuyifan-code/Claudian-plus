import {
  ANTIGRAVITY_DEFAULT_TIMEOUT_MS,
  DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
  getAntigravityProviderSettings,
  normalizeAntigravityTimeoutMs,
  recordAntigravityLastFailure,
  requestAntigravityDiagnosticsRefresh,
  updateAntigravityProviderSettings,
} from '@/providers/antigravity/settings';

const PRIVATE_WINDOWS_PATH = 'C:\\Users\\ada\\AppData\\Local\\agy\\bin\\agy.EXE';

function readProviderConfig(bag: Record<string, unknown>): Record<string, unknown> {
  return (bag.providerConfigs as Record<string, Record<string, unknown>>).antigravity;
}

function createSettingsBag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS, ...overrides },
    },
  };
}

describe('getAntigravityProviderSettings', () => {
  it('defaults to disabled with an empty manual model id', () => {
    const settings = getAntigravityProviderSettings({ providerConfigs: {} });
    expect(settings.enabled).toBe(false);
    expect(settings.autoApproveTools).toBe(true);
    expect(settings.cliPath).toBe('');
    expect(settings.cliPathsByHost).toEqual({});
    expect(settings.manualModelId).toBe('');
    expect(settings.environmentVariables).toBe('');
  });

  it('defaults the timeout and never trusts invalid timeout values', () => {
    expect(getAntigravityProviderSettings({}).timeoutMs).toBe(ANTIGRAVITY_DEFAULT_TIMEOUT_MS);
    expect(getAntigravityProviderSettings(createSettingsBag({ timeoutMs: 45_000 })).timeoutMs)
      .toBe(45_000);
    expect(getAntigravityProviderSettings(createSettingsBag({ timeoutMs: 0 })).timeoutMs)
      .toBe(ANTIGRAVITY_DEFAULT_TIMEOUT_MS);
    expect(getAntigravityProviderSettings(createSettingsBag({ timeoutMs: -5 })).timeoutMs)
      .toBe(ANTIGRAVITY_DEFAULT_TIMEOUT_MS);
    expect(getAntigravityProviderSettings(createSettingsBag({ timeoutMs: '30s' })).timeoutMs)
      .toBe(ANTIGRAVITY_DEFAULT_TIMEOUT_MS);
    expect(getAntigravityProviderSettings(createSettingsBag({ timeoutMs: Number.NaN })).timeoutMs)
      .toBe(ANTIGRAVITY_DEFAULT_TIMEOUT_MS);
  });

  it('drops blank per-host cli paths and keeps non-blank ones', () => {
    const settings = getAntigravityProviderSettings(createSettingsBag({
      cliPathsByHost: { 'host-a': 'C:\\agy\\agy.EXE', 'host-b': '   ' },
    }));
    expect(settings.cliPathsByHost).toEqual({ 'host-a': 'C:\\agy\\agy.EXE' });
  });

  it('normalizes the manual model id by trimming only', () => {
    const settings = getAntigravityProviderSettings(createSettingsBag({ manualModelId: '  gemini-3.8-flash-low  ' }));
    expect(settings.manualModelId).toBe('gemini-3.8-flash-low');
    const invalid = getAntigravityProviderSettings(createSettingsBag({ manualModelId: 42 }));
    expect(invalid.manualModelId).toBe('');
  });

  it('defaults environment variables to an empty string when nothing is persisted', () => {
    // The legacy per-provider fallback in providerEnvironment only classifies
    // keys for registered providers, so pre-registration the fallback is ''.
    const settings = getAntigravityProviderSettings({ providerConfigs: {} });
    expect(settings.environmentVariables).toBe('');

    const bag = createSettingsBag({ environmentVariables: 'ANTIGRAVITY_TEST_MARKER=1' });
    expect(getAntigravityProviderSettings(bag).environmentVariables).toBe('ANTIGRAVITY_TEST_MARKER=1');
  });
});

describe('normalizeAntigravityTimeoutMs', () => {
  it('floors positive finite numbers and defaults otherwise', () => {
    expect(normalizeAntigravityTimeoutMs(1_500.9)).toBe(1_500);
    expect(normalizeAntigravityTimeoutMs(undefined)).toBe(ANTIGRAVITY_DEFAULT_TIMEOUT_MS);
    expect(normalizeAntigravityTimeoutMs(Infinity)).toBe(ANTIGRAVITY_DEFAULT_TIMEOUT_MS);
  });
});

describe('updateAntigravityProviderSettings', () => {
  it('stores the cli path under the current host key and leaves cliPath empty for resolution', () => {
    const bag = createSettingsBag({});
    updateAntigravityProviderSettings(bag, { cliPath: 'C:\\agy\\agy.EXE' });
    const settings = getAntigravityProviderSettings(bag);
    expect(settings.cliPath).toBe('');
    expect(Object.values(settings.cliPathsByHost)).toContain('C:\\agy\\agy.EXE');
  });

  it('clears the host entry when the cli path is emptied', () => {
    const bag = createSettingsBag({ cliPathsByHost: { placeholder: 'D:\\other\\agy.EXE' } });
    updateAntigravityProviderSettings(bag, { cliPath: 'C:\\agy\\agy.EXE' });
    expect(Object.values(getAntigravityProviderSettings(bag).cliPathsByHost))
      .toContain('C:\\agy\\agy.EXE');
    updateAntigravityProviderSettings(bag, { cliPath: '' });
    const settings = getAntigravityProviderSettings(bag);
    expect(Object.values(settings.cliPathsByHost)).not.toContain('C:\\agy\\agy.EXE');
    // A path stored for another host key must survive the current-host clear.
    expect(settings.cliPathsByHost['placeholder']).toBe('D:\\other\\agy.EXE');
  });

  it('preserves unrelated provider configs and unrelated top-level settings', () => {
    const bag: Record<string, unknown> = {
      defaultChatProviderId: 'codex',
      model: 'openai-codex/gpt-5',
      providerConfigs: {
        codex: { enabled: true, cliPath: 'C:\\codex\\codex.exe' },
        antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS },
      },
    };

    updateAntigravityProviderSettings(bag, {
      enabled: true,
      manualModelId: 'gemini-3.8-flash-low',
      timeoutMs: 90_000,
    });

    expect((bag.providerConfigs as Record<string, unknown>).codex).toEqual({
      enabled: true,
      cliPath: 'C:\\codex\\codex.exe',
    });
    expect(bag.model).toBe('openai-codex/gpt-5');
    expect(bag.defaultChatProviderId).toBe('codex');

    const antigravity = getAntigravityProviderSettings(bag);
    expect(antigravity.enabled).toBe(true);
    expect(antigravity.manualModelId).toBe('gemini-3.8-flash-low');
    expect(antigravity.timeoutMs).toBe(90_000);
  });

  it('round-trips every persisted field without inventing new ones', () => {
    const bag = createSettingsBag({});
    const updated = updateAntigravityProviderSettings(bag, {
      autoApproveTools: false,
      cliPath: 'C:\\agy\\agy.EXE',
      diagnosticsRefreshToken: 3,
      enabled: true,
      environmentVariables: 'ANTIGRAVITY_TEST_MARKER=1',
      manualModelId: 'gemini-3.1-pro-low',
      timeoutMs: 60_000,
    });

    expect(Object.keys(updated).sort()).toEqual(
      Object.keys(DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS).sort(),
    );
    expect(getAntigravityProviderSettings(bag)).toMatchObject({
      autoApproveTools: false,
      enabled: true,
      manualModelId: 'gemini-3.1-pro-low',
      timeoutMs: 60_000,
      diagnosticsRefreshToken: 3,
    });
  });

  it('normalizes an invalid timeout update back to the default', () => {
    const bag = createSettingsBag({});
    updateAntigravityProviderSettings(bag, { timeoutMs: 0 });
    expect(getAntigravityProviderSettings(bag).timeoutMs).toBe(ANTIGRAVITY_DEFAULT_TIMEOUT_MS);
  });
});

describe('requestAntigravityDiagnosticsRefresh', () => {
  it('increments the persisted token and returns the new value', () => {
    const bag = createSettingsBag({ diagnosticsRefreshToken: 2 });
    expect(requestAntigravityDiagnosticsRefresh(bag)).toBe(3);
    expect(requestAntigravityDiagnosticsRefresh(bag)).toBe(4);
    expect(getAntigravityProviderSettings(bag).diagnosticsRefreshToken).toBe(4);
  });
});

describe('last startup failure', () => {
  it('defaults to nothing recorded', () => {
    expect(getAntigravityProviderSettings({ providerConfigs: {} }).lastFailure).toBeNull();
    expect(DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.lastFailure).toBeNull();
  });

  it('records one bounded entry and overwrites it instead of accumulating', () => {
    const bag = createSettingsBag({});
    const keyCountBefore = Object.keys(readProviderConfig(bag)).length;

    const first = recordAntigravityLastFailure(bag, 'cli-missing');
    expect(getAntigravityProviderSettings(bag).lastFailure).toEqual(first);

    const second = recordAntigravityLastFailure(bag, 'spawn-failed', 'exit code 1');
    const stored = getAntigravityProviderSettings(bag).lastFailure;
    expect(stored?.category).toBe('spawn-failed');
    expect(stored?.recordedAt).toBe(second.recordedAt);
    expect(stored?.detail).toBe('exit code 1');

    // Overwriting, not appending: the config keeps a single entry and never grows a list.
    expect(Array.isArray(readProviderConfig(bag).lastFailure)).toBe(false);
    expect(Object.keys(readProviderConfig(bag)).length).toBe(keyCountBefore);
  });

  it('survives a reload of the persisted provider settings bag', () => {
    const persisted = createSettingsBag({});
    recordAntigravityLastFailure(persisted, 'timeout', 'exit code 1');

    // Mirrors the storage adapter: a fresh bag is normalized from the persisted projection.
    const reloaded: Record<string, unknown> = { providerConfigs: {} };
    updateAntigravityProviderSettings(reloaded, getAntigravityProviderSettings(persisted));

    expect(getAntigravityProviderSettings(reloaded).lastFailure)
      .toEqual(getAntigravityProviderSettings(persisted).lastFailure);
  });

  it('never persists a failure detail that carries a path, an email, or a token', () => {
    const bag = createSettingsBag({});
    recordAntigravityLastFailure(
      bag,
      'spawn-failed',
      `ENOENT ${PRIVATE_WINDOWS_PATH} ada@example.com sk-live-0123456789abcdefghij`,
    );

    const serialized = JSON.stringify(bag);
    expect(serialized).not.toContain('ada');
    expect(serialized).not.toContain('example.com');
    expect(serialized).not.toContain('sk-live-0123456789abcdefghij');
    expect(serialized).not.toContain('AppData');
  });

  it('keeps unrelated settings untouched when recording, and refuses an unknown category', () => {
    const bag: Record<string, unknown> = {
      defaultChatProviderId: 'codex',
      providerConfigs: {
        codex: { enabled: true },
        antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS },
      },
    };

    expect(() => recordAntigravityLastFailure(bag, 'missing-cli' as never)).toThrow(RangeError);
    expect(getAntigravityProviderSettings(bag).lastFailure).toBeNull();

    recordAntigravityLastFailure(bag, 'malformed-stream');
    expect(bag.defaultChatProviderId).toBe('codex');
    expect((bag.providerConfigs as Record<string, unknown>).codex).toEqual({ enabled: true });
    expect(getAntigravityProviderSettings(bag).lastFailure?.category).toBe('malformed-stream');
  });

  it('normalizes a hand-edited failure value without throwing', () => {
    for (const garbage of [
      'spawn-failed',
      42,
      [],
      { category: 'unknown', recordedAt: 1 },
      { category: 'timeout' },
      { category: 'timeout', recordedAt: Number.NaN },
      { category: 'timeout', recordedAt: 'soon' },
    ]) {
      expect(getAntigravityProviderSettings(createSettingsBag({ lastFailure: garbage })).lastFailure)
        .toBeNull();
    }
  });

  it('drops a non-string persisted detail but keeps the entry', () => {
    const bag = createSettingsBag({
      lastFailure: { category: 'spawn-failed', recordedAt: 1, detail: { message: PRIVATE_WINDOWS_PATH } },
    });
    expect(getAntigravityProviderSettings(bag).lastFailure)
      .toEqual({ category: 'spawn-failed', recordedAt: 1 });
  });

  it('re-redacts a persisted detail that was hand-edited to a private path', () => {
    const bag = createSettingsBag({
      lastFailure: { category: 'spawn-failed', recordedAt: 1, detail: `ENOENT ${PRIVATE_WINDOWS_PATH}` },
    });
    expect(getAntigravityProviderSettings(bag).lastFailure?.detail).toBe('ENOENT [redacted-path]');
  });
});
