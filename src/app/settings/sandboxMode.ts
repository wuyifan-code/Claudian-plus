import type { ClaudianPlusSettings, SandboxMode } from '../../core/types/settings';

/**
 * Reads the sandbox axis for settings saved before it existed.
 *
 * The old boolean YOLO switch folds into this axis: on became `full` (which
 * keeps bypassing approvals) and off became `workspace` (inside the vault, the
 * default a fresh install gets). Nothing is written back here — the caller owns
 * persistence, and a read must never rewrite a user's file.
 */
export function resolveSandboxMode(
  settings: Pick<ClaudianPlusSettings, 'sandboxMode' | 'permissionMode'>,
): SandboxMode {
  if (settings.sandboxMode === 'read' || settings.sandboxMode === 'workspace' || settings.sandboxMode === 'full') {
    return settings.sandboxMode;
  }
  return settings.permissionMode === 'yolo' ? 'full' : 'workspace';
}

/** `full` is the only mode that also bypasses approvals. */
export function sandboxBypassesApprovals(mode: SandboxMode): boolean {
  return mode === 'full';
}
