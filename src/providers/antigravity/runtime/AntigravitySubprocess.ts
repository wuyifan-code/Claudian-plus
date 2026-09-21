import {
  type SubprocessLaunchSpec,
  SubprocessRunner,
} from '../../../core/runtime/SubprocessRunner';
import {
  assertNoForbiddenAntigravityFlags,
  requireAntigravityCliPath,
} from './AntigravityLaunchSpec';

export interface AntigravitySubprocessLaunchSpec extends SubprocessLaunchSpec {
  allowDangerouslySkipPermissions?: boolean;
}

/**
 * Antigravity CLI process wrapper. Process management (windowsHide, Windows
 * .cmd shims, bounded stderr snapshot, SIGTERM -> SIGKILL escalation) comes
 * from the shared SubprocessRunner; this class only enforces the provider's
 * launch-safety invariants before a spawn can happen.
 */
export class AntigravitySubprocess extends SubprocessRunner {
  constructor(launchSpec: AntigravitySubprocessLaunchSpec) {
    assertNoForbiddenAntigravityFlags(launchSpec.args, {
      allowDangerouslySkipPermissions: launchSpec.allowDangerouslySkipPermissions,
    });
    requireAntigravityCliPath(launchSpec.command);
    super(launchSpec, { providerName: 'Antigravity', enhancePath: true });
  }
}
