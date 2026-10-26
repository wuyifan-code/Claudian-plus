import type { ClaudianPlusSettings } from '../../core/types/settings';

/** Onboarding flag and device key live here instead of the renderer storage. */
export const RUNTIME_ONBOARDING_SEEN = 'blob.onboardingSeen';
export const RUNTIME_DEVICE_KEY = 'deviceSettingsKey';

export interface RuntimeStateStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/**
 * Synchronous key/value view over `settings.runtimeState`.
 *
 * The welcome flow and the CLI resolvers both need a synchronous read, so the
 * store reads straight from the settings object and asks the plugin to persist
 * after a write. Persistence is the caller's concern; this only owns the shape.
 */
export function createRuntimeStateStore(
  getSettings: () => ClaudianPlusSettings,
  persist: () => void,
): RuntimeStateStore {
  const stateOf = (): Record<string, string> => {
    const settings = getSettings();
    settings.runtimeState ??= {};
    return settings.runtimeState;
  };

  return {
    get(key: string): string | null {
      const value = stateOf()[key];
      return typeof value === 'string' ? value : null;
    },
    set(key: string, value: string): void {
      const state = stateOf();
      if (state[key] === value) return;
      state[key] = value;
      persist();
    },
  };
}

function collectHostScopedMaps(value: unknown, depth: number, out: Array<Record<string, string>>): void {
  if (depth > 3 || value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const map = record.cliPathsByHost;
  if (map !== null && typeof map === 'object' && !Array.isArray(map)) {
    const entries = Object.entries(map as Record<string, unknown>)
      .filter(([, path]) => typeof path === 'string');
    if (entries.length > 0) out.push(Object.fromEntries(entries) as Record<string, string>);
  }
  for (const child of Object.values(record)) {
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      collectHostScopedMaps(child, depth + 1, out);
    }
  }
}

/**
 * Adopts the device key an earlier build kept in the renderer storage.
 *
 * Only unambiguous cases are adopted: exactly one per-install key across every
 * provider map. Two keys means the settings travelled between machines, and
 * guessing would hand one machine the other machine's CLI path.
 */
export function adoptLegacyDeviceKey(settings: ClaudianPlusSettings): string | null {
  const maps: Array<Record<string, string>> = [];
  collectHostScopedMaps(settings, 0, maps);
  const keys = new Set<string>();
  for (const map of maps) {
    for (const key of Object.keys(map)) {
      if (key.startsWith('device:')) keys.add(key);
    }
  }
  if (keys.size !== 1) return null;
  return [...keys][0];
}
