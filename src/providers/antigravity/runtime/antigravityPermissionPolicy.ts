import type { SandboxMode } from '../../../core/types/settings';

/**
 * Whether the CLI may run with `--dangerously-skip-permissions`.
 *
 * The read-only tier must never hand the CLI a blanket skip, whatever the
 * provider's own auto-approve preference says; workspace keeps that preference;
 * full always skips.
 */
export function resolveAntigravitySkipPermissions(
  autoApproveTools: boolean,
  sandboxMode: SandboxMode,
): boolean {
  if (sandboxMode === 'read') {
    return false;
  }
  if (sandboxMode === 'full') {
    return true;
  }
  return autoApproveTools;
}
