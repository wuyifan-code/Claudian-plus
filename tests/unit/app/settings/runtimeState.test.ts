import {
  adoptLegacyDeviceKey,
  createRuntimeStateStore,
  RUNTIME_DEVICE_KEY,
  RUNTIME_ONBOARDING_SEEN,
} from '@/app/settings/runtimeState';
import type { ClaudianPlusSettings } from '@/core/types/settings';

function settingsWith(extra: Record<string, unknown> = {}): ClaudianPlusSettings {
  return { ...(extra as object) } as ClaudianPlusSettings;
}

describe('runtime state store', () => {
  it('reads null for a missing entry and persists on change', () => {
    const settings = settingsWith();
    const persist = jest.fn();
    const store = createRuntimeStateStore(() => settings, persist);

    expect(store.get(RUNTIME_ONBOARDING_SEEN)).toBeNull();

    store.set(RUNTIME_ONBOARDING_SEEN, '1');
    expect(store.get(RUNTIME_ONBOARDING_SEEN)).toBe('1');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not persist an unchanged value', () => {
    const settings = settingsWith({ runtimeState: { [RUNTIME_DEVICE_KEY]: 'device:a' } });
    const persist = jest.fn();
    const store = createRuntimeStateStore(() => settings, persist);

    store.set(RUNTIME_DEVICE_KEY, 'device:a');
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('adopting the legacy device key', () => {
  it('adopts the only per-install key left by an earlier build', () => {
    const settings = settingsWith({
      claude: { cliPathsByHost: { 'device:abc': '/usr/local/bin/claude' } },
      codex: { cliPathsByHost: { 'device:abc': '/usr/local/bin/codex' } },
    });

    expect(adoptLegacyDeviceKey(settings)).toBe('device:abc');
  });

  it('refuses to guess when settings travelled between machines', () => {
    const settings = settingsWith({
      claude: { cliPathsByHost: { 'device:a': '/a' } },
      codex: { cliPathsByHost: { 'device:b': '/b' } },
    });

    expect(adoptLegacyDeviceKey(settings)).toBeNull();
  });

  it('ignores hostname-keyed maps and empty settings', () => {
    expect(adoptLegacyDeviceKey(settingsWith())).toBeNull();
    expect(adoptLegacyDeviceKey(settingsWith({
      claude: { cliPathsByHost: { 'my-laptop': '/a' } },
    }))).toBeNull();
  });
});
