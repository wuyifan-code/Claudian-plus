import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';

/** Owns the concrete provider runtime attached to one tab. */
export class RuntimeSupervisor {
  constructor(private runtime: ChatRuntime | null = null) {}

  get current(): ChatRuntime | null {
    return this.runtime;
  }

  setCurrent(runtime: ChatRuntime | null): void {
    this.runtime = runtime;
  }

  cleanup(): void {
    const runtime = this.runtime;
    // Some runtimes keep these callbacks in process/request-router state. Clear
    // them before teardown so a late provider request cannot target a closed tab.
    runtime?.setApprovalCallback?.(null);
    runtime?.setApprovalDismisser?.(null);
    runtime?.setAskUserQuestionCallback?.(null);
    runtime?.setExitPlanModeCallback?.(null);
    runtime?.setPermissionModeSyncCallback?.(null);
    runtime?.setAsyncSubagentCompletionCallback?.(null);
    runtime?.setAutoTurnCallback?.(null);
    runtime?.cleanup();
    if (this.runtime === runtime) {
      this.runtime = null;
    }
  }
}
