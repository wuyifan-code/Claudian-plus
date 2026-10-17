import { type SubprocessLaunchSpec, SubprocessRunner } from '../../../core/runtime/SubprocessRunner';

export class DshSubprocess extends SubprocessRunner {
  constructor(spec: SubprocessLaunchSpec, private readonly gracefulMs = 8000) {
    super(spec, { providerName: 'DeepSeek Harness', enhancePath: true });
  }

  override async shutdown(): Promise<void> {
    if (!this.isAlive()) return;
    await new Promise<void>(resolve => {
      const finish = () => { window.clearTimeout(timer); this.offExit(onExit); resolve(); };
      const onExit = () => finish();
      const timer = window.setTimeout(finish, this.gracefulMs);
      this.onExit(onExit);
      this.stdin.on('error', () => {}).end();
    });
    if (this.isAlive()) await super.shutdown();
  }
}
