import {
  type SubprocessLaunchSpec,
  SubprocessRunner,
} from '../../../core/runtime/SubprocessRunner';
import type { CodexLaunchSpec } from './codexLaunchTypes';

export class CodexAppServerProcess extends SubprocessRunner {
  constructor(launchSpec: Pick<CodexLaunchSpec, 'command' | 'args' | 'spawnCwd' | 'env'>) {
    super(
      {
        args: launchSpec.args,
        command: launchSpec.command,
        cwd: launchSpec.spawnCwd,
        env: launchSpec.env,
      } satisfies SubprocessLaunchSpec,
      {
        providerName: 'Codex',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  }
}
