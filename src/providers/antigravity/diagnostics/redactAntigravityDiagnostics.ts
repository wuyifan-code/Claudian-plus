import type { AntigravityLastFailure } from '../lastFailure';
import { normalizeAntigravityLastFailure } from '../lastFailure';
import { ANTIGRAVITY_PROVIDER_ID } from '../runtime/AntigravityLaunchSpec';
import { basenameAntigravityPath, redactAntigravityText } from './antigravityRedaction';

/**
 * Redacted diagnostics snapshot for the Antigravity provider.
 *
 * The snapshot is a whitelist projection, not a dump: it carries the plugin and
 * provider version, whether the CLI resolved (with the executable *name* only,
 * never its directory), the capability statement, and the last failure record
 * (its category, its timestamp, and its already bounded, already redacted
 * detail). Anything else — prompt or message content, conversation text,
 * environment, working directory, or an unknown field — is dropped before it can
 * be serialized, and every surviving string is passed through
 * `redactAntigravityText`.
 *
 * Everything here is pure and offline: building a snapshot resolves nothing,
 * spawns no process, and issues no model request. Resolution is the caller's
 * business, and the settings tab passes the already-resolved path in.
 */

export const ANTIGRAVITY_DIAGNOSTICS_SCHEMA_VERSION = 1;

const MAX_CAPABILITY_ENTRIES = 32;
const MAX_TEXT_LENGTH = 64;

export interface AntigravityDiagnosticsCliInfo {
  resolved: boolean;
  /** Executable name only; a full private path is never exported. */
  executable: string | null;
}

export interface AntigravityDiagnosticsSnapshot {
  schemaVersion: number;
  providerId: string;
  pluginVersion: string;
  cli: AntigravityDiagnosticsCliInfo;
  capabilities: Record<string, boolean | string>;
  lastFailure: AntigravityLastFailure | null;
}

export interface AntigravityDiagnosticsInput {
  /** Capability statement; only boolean and short string values survive. */
  capabilities?: object | null;
  lastFailure?: AntigravityLastFailure | null;
  pluginVersion?: string | null;
  /** Already-resolved CLI path, or null when resolution failed. */
  resolvedCliPath?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBoundedText(value: unknown, fallback: string): string {
  const text = readString(value);
  return text ? redactAntigravityText(text).slice(0, MAX_TEXT_LENGTH) : fallback;
}

function readSlug(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value) ? value : fallback;
}

function projectCli(value: unknown): AntigravityDiagnosticsCliInfo {
  const cli = isRecord(value) ? value : {};
  const candidate = readString(cli.executable) ?? readString(cli.path) ?? '';
  const executable = redactAntigravityText(basenameAntigravityPath(candidate));
  const resolved = cli.resolved === true && executable !== '';
  return { resolved, executable: resolved ? executable : null };
}

function projectCapabilities(value: unknown): Record<string, boolean | string> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, boolean | string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (Object.keys(result).length >= MAX_CAPABILITY_ENTRIES) {
      break;
    }
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)) {
      continue;
    }
    if (typeof entry === 'boolean') {
      result[key] = entry;
    } else if (typeof entry === 'string' && entry.trim()) {
      result[key] = redactAntigravityText(entry.trim()).slice(0, MAX_TEXT_LENGTH);
    }
  }
  return result;
}

/**
 * Projects arbitrary input down to the allowed snapshot fields. Safe to call on
 * anything, including a snapshot that an older or hand-edited build produced.
 */
export function redactAntigravityDiagnostics(raw: unknown): AntigravityDiagnosticsSnapshot {
  const source = isRecord(raw) ? raw : {};
  return {
    schemaVersion: ANTIGRAVITY_DIAGNOSTICS_SCHEMA_VERSION,
    providerId: readSlug(source.providerId, ANTIGRAVITY_PROVIDER_ID),
    pluginVersion: readBoundedText(source.pluginVersion, 'unknown'),
    cli: projectCli(source.cli),
    capabilities: projectCapabilities(source.capabilities),
    lastFailure: normalizeAntigravityLastFailure(source.lastFailure),
  };
}

export function buildAntigravityDiagnosticsSnapshot(
  input: AntigravityDiagnosticsInput,
): AntigravityDiagnosticsSnapshot {
  const executable = typeof input.resolvedCliPath === 'string'
    ? basenameAntigravityPath(input.resolvedCliPath)
    : '';
  return redactAntigravityDiagnostics({
    schemaVersion: ANTIGRAVITY_DIAGNOSTICS_SCHEMA_VERSION,
    providerId: ANTIGRAVITY_PROVIDER_ID,
    pluginVersion: input.pluginVersion ?? null,
    // `resolved` reports resolution only; the path itself never leaves the machine.
    cli: { resolved: executable !== '', executable },
    capabilities: input.capabilities ?? {},
    lastFailure: input.lastFailure ?? null,
  });
}

/** The exact text the settings tab copies, so the export and its tests agree. */
export function formatAntigravityDiagnosticsReport(input: AntigravityDiagnosticsInput): string {
  return JSON.stringify(buildAntigravityDiagnosticsSnapshot(input), null, 2);
}
