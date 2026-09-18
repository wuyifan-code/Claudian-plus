import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import type { AntigravityFailureCategory, AntigravityLastFailure } from './lastFailure';
import { createAntigravityLastFailure, normalizeAntigravityLastFailure } from './lastFailure';
import { normalizeAntigravityManualModelId } from './models';

export interface PersistedAntigravityProviderSettings {
  /** CLI path for the current host; empty means "use CLI resolution". */
  cliPath: string;
  /** Per-host CLI overrides. A host with no entry (or an empty one) resolves. */
  cliPathsByHost: HostnameCliPaths;
  /**
   * Monotonic counter the settings UI bumps to request a diagnostics refresh
   * (CLI resolution, version probe). Persisted so a refresh survives a
   * settings re-render; bumping it never launches the CLI by itself.
   */
  diagnosticsRefreshToken: number;
  enabled: boolean;
  environmentHash: string;
  /** User-configured environment variables passed to the agy subprocess. */
  environmentVariables: string;
  /**
   * Most recent startup/spawn/init failure, recorded by the runtime and shown
   * read-only in the settings tab. At most one entry: it is overwritten in
   * place, never accumulated, and its detail is pre-redacted and bounded.
   */
  lastFailure: AntigravityLastFailure | null;
  /** Bare model id handed to `agy --model`; empty until the user sets one. */
  manualModelId: string;
  /** Per-turn print timeout in milliseconds; floors to whole milliseconds. */
  timeoutMs: number;
}

export type AntigravityProviderSettings = PersistedAntigravityProviderSettings;

/**
 * Per-turn print timeout default. A0 measured 13-16 s of process startup for a
 * trivial one-token reply, so the default leaves generous headroom for real
 * turns while still bounding a hung CLI.
 */
export const ANTIGRAVITY_DEFAULT_TIMEOUT_MS = 120_000;

export const DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS: Readonly<PersistedAntigravityProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  diagnosticsRefreshToken: 0,
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  lastFailure: null,
  manualModelId: '',
  timeoutMs: ANTIGRAVITY_DEFAULT_TIMEOUT_MS,
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

export function normalizeAntigravityTimeoutMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return ANTIGRAVITY_DEFAULT_TIMEOUT_MS;
}

export function getAntigravityProviderSettings(
  settings: Record<string, unknown>,
): AntigravityProviderSettings {
  const config = getProviderConfig(settings, 'antigravity');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;

  return {
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    diagnosticsRefreshToken: normalizeAntigravityDiagnosticsRefreshToken(
      config.diagnosticsRefreshToken,
    ),
    enabled: config.enabled === true,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'antigravity')
      ?? DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.environmentVariables,
    lastFailure: normalizeAntigravityLastFailure(config.lastFailure),
    manualModelId: normalizeAntigravityManualModelId(config.manualModelId),
    timeoutMs: normalizeAntigravityTimeoutMs(config.timeoutMs),
  };
}

function normalizeAntigravityDiagnosticsRefreshToken(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.diagnosticsRefreshToken;
}

export function updateAntigravityProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<AntigravityProviderSettings>,
): AntigravityProviderSettings {
  const current = getAntigravityProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath;
  }

  const next: AntigravityProviderSettings = {
    ...current,
    ...updates,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    diagnosticsRefreshToken: normalizeAntigravityDiagnosticsRefreshToken(
      updates.diagnosticsRefreshToken ?? current.diagnosticsRefreshToken,
    ),
    enabled: (updates.enabled ?? current.enabled) === true,
    environmentVariables: typeof updates.environmentVariables === 'string'
      ? updates.environmentVariables
      : current.environmentVariables,
    // `null` is an explicit clear, so the current value is only reused when the
    // update does not mention the field at all.
    lastFailure: 'lastFailure' in updates
      ? normalizeAntigravityLastFailure(updates.lastFailure)
      : current.lastFailure,
    manualModelId: normalizeAntigravityManualModelId(
      updates.manualModelId ?? current.manualModelId,
    ),
    timeoutMs: normalizeAntigravityTimeoutMs(updates.timeoutMs ?? current.timeoutMs),
  };

  // The provider config bag is provider-owned and rewritten whole; other
  // providers' configs and unrelated top-level settings are never touched.
  setProviderConfig(settings, 'antigravity', {
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    diagnosticsRefreshToken: next.diagnosticsRefreshToken,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    lastFailure: next.lastFailure,
    manualModelId: next.manualModelId,
    timeoutMs: next.timeoutMs,
  });

  return next;
}

/**
 * Persists the most recent failure, replacing any earlier entry.
 *
 * Called by the runtime when a turn cannot start. It is the only write path for
 * `lastFailure`, so the redaction and bounding applied by
 * `createAntigravityLastFailure` cannot be bypassed.
 */
export function recordAntigravityLastFailure(
  settings: Record<string, unknown>,
  category: AntigravityFailureCategory,
  detail?: string,
): AntigravityLastFailure {
  const failure = createAntigravityLastFailure(category, detail === undefined ? {} : { detail });
  updateAntigravityProviderSettings(settings, { lastFailure: failure });
  return failure;
}

/**
 * Diagnostics-refresh hook for the settings UI: bumps the persisted token so
 * observers re-run CLI diagnostics (resolution, version, last failure). This
 * is bookkeeping only — it never spawns the CLI or issues a model request.
 */
export function requestAntigravityDiagnosticsRefresh(
  settings: Record<string, unknown>,
): number {
  const nextToken = getAntigravityProviderSettings(settings).diagnosticsRefreshToken + 1;
  updateAntigravityProviderSettings(settings, { diagnosticsRefreshToken: nextToken });
  return nextToken;
}
