import type { SandboxMode } from '../../../core/types/settings';
import type { PiToolMode } from '../settings';

/**
 * Pi has no sandbox switch of its own; its read-only tool list is the guard.
 *
 * The sandbox tier therefore narrows the tool mode for the launch, and a
 * workspace or full tier keeps whatever the user configured.
 */
export function resolvePiToolMode(toolMode: PiToolMode, sandboxMode: SandboxMode): PiToolMode {
  return sandboxMode === 'read' ? 'readonly' : toolMode;
}
