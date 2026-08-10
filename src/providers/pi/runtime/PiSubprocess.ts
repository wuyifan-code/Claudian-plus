import {
  type SubprocessLaunchSpec,
  SubprocessRunner,
} from '../../../core/runtime/SubprocessRunner';

export type PiSubprocessLaunchSpec = SubprocessLaunchSpec;

export class PiSubprocess extends SubprocessRunner {
  constructor(launchSpec: PiSubprocessLaunchSpec) {
    super(launchSpec, { providerName: 'Pi', enhancePath: true });
  }
}
