import type { PermissionMode, SandboxMode } from '../types/settings';

/**
 * Settings as the provider adapters see them: a plain bag, not the typed
 * settings object. Both axes are read defensively because a provider snapshot
 * is `Record<string, unknown>` at the call sites.
 */
export interface SandboxAxisSettings {
  permissionMode?: unknown;
  sandboxMode?: unknown;
}

function readSandboxMode(value: unknown): SandboxMode | null {
  return value === 'read' || value === 'workspace' || value === 'full' ? value : null;
}

function readPermissionMode(value: unknown): PermissionMode {
  return value === 'yolo' || value === 'plan' ? value : 'normal';
}

/**
 * Reads the sandbox axis for settings saved before it existed.
 *
 * The old boolean YOLO switch folds into this axis: on became `full` (which
 * keeps bypassing approvals) and off became `workspace` (inside the vault, the
 * default a fresh install gets). Nothing is written back here — the caller owns
 * persistence, and a read must never rewrite a user's file.
 */
export function resolveSandboxMode(settings: SandboxAxisSettings): SandboxMode {
  const explicit = readSandboxMode(settings.sandboxMode);
  if (explicit !== null) {
    return explicit;
  }
  return readPermissionMode(settings.permissionMode) === 'yolo' ? 'full' : 'workspace';
}

/** `full` is the only mode that also bypasses approvals. */
export function sandboxBypassesApprovals(mode: SandboxMode): boolean {
  return mode === 'full';
}

/**
 * The approval mode the runtimes should act on.
 *
 * `full` is defined as the old YOLO behavior, so it reports as `yolo` at every
 * execution boundary — that keeps the five provider adapters on their existing
 * code paths instead of teaching each one about a second axis. Plan mode always
 * wins: it is an approval mode, not a sandbox.
 *
 * `override` lets a caller pass the mode it already resolved for the active tab;
 * the sandbox still decides whether approvals are bypassed.
 */
export function effectivePermissionMode(
  settings: SandboxAxisSettings,
  override?: PermissionMode,
): PermissionMode {
  const approval = override ?? readPermissionMode(settings.permissionMode);
  if (approval === 'plan') {
    return 'plan';
  }
  const sandbox = resolveSandboxMode({ sandboxMode: settings.sandboxMode, permissionMode: approval });
  return sandboxBypassesApprovals(sandbox) ? 'yolo' : 'normal';
}
