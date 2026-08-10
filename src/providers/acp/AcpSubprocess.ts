import {
  type SubprocessLaunchSpec,
  SubprocessRunner,
} from '../../core/runtime/SubprocessRunner';

export type AcpSubprocessLaunchSpec = SubprocessLaunchSpec;

export class AcpSubprocess extends SubprocessRunner {
  constructor(launchSpec: AcpSubprocessLaunchSpec) {
    super(launchSpec, { providerName: 'ACP' });
  }
}
