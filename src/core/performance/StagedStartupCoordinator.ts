import type { CooperativeTask, TaskContext, TaskPriority } from './CooperativeIdleScheduler';
import { CooperativeIdleScheduler } from './CooperativeIdleScheduler';
import { StartupProfiler } from './StartupProfiler';

export enum StartupPhase {
  Uninitialized = 'uninitialized',
  Phase0_ShellReady = 'phase0_shell_ready',
  Phase1_ActiveTabReady = 'phase1_active_tab_ready',
  Phase2_IdleBackground = 'phase2_idle_background',
}

export type StagedTaskFn = (context?: TaskContext) => Promise<void> | void;

export interface RegisteredServiceRecord {
  id: string;
  name: string;
  fn: StagedTaskFn;
  priority?: TaskPriority;
  isReady: boolean;
  scheduledTaskId?: string;
  runningPromise?: Promise<void>;
}

export interface StagedStartupCoordinatorOptions {
  scheduler?: CooperativeIdleScheduler;
}

export class StagedStartupCoordinator {
  private currentPhase = StartupPhase.Uninitialized;
  private scheduler: CooperativeIdleScheduler;
  private ownScheduler = false;
  private phase0Tasks: Array<{ name: string; fn: StagedTaskFn }> = [];
  private phase1Tasks: Array<{ name: string; fn: StagedTaskFn }> = [];
  private services = new Map<string, RegisteredServiceRecord>();
  private _isDisposed = false;

  constructor(options: StagedStartupCoordinatorOptions = {}) {
    if (options.scheduler) {
      this.scheduler = options.scheduler;
    } else {
      this.scheduler = new CooperativeIdleScheduler();
      this.ownScheduler = true;
    }
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  getCurrentPhase(): StartupPhase {
    return this.currentPhase;
  }

  isServiceReady(serviceId: string): boolean {
    return this.services.get(serviceId)?.isReady ?? false;
  }

  registerPhase0Task(name: string, fn: StagedTaskFn): void {
    if (this._isDisposed) return;
    this.phase0Tasks.push({ name, fn });
  }

  registerPhase1Task(name: string, fn: StagedTaskFn): void {
    if (this._isDisposed) return;
    this.phase1Tasks.push({ name, fn });
  }

  registerIdleTask(
    id: string,
    name: string,
    fn: StagedTaskFn,
    priority: TaskPriority = 'idle',
  ): void {
    if (this._isDisposed) return;

    const record: RegisteredServiceRecord = {
      id,
      name,
      fn,
      priority,
      isReady: false,
    };
    this.services.set(id, record);

    if (this.currentPhase === StartupPhase.Phase2_IdleBackground) {
      this.scheduleServiceOnIdle(record);
    }
  }

  async advanceToPhase(phase: StartupPhase): Promise<void> {
    if (this._isDisposed) return;

    if (phase === StartupPhase.Phase0_ShellReady) {
      this.currentPhase = StartupPhase.Phase0_ShellReady;
      const span = StartupProfiler.start('phase0-shell-duration');
      try {
        for (const task of this.phase0Tasks) {
          try {
            const res = task.fn();
            if (res instanceof Promise) {
              await res;
            }
          } catch {
            StartupProfiler.increment('phase0-task-errors');
          }
        }
      } finally {
        StartupProfiler.finish(span);
      }
    } else if (phase === StartupPhase.Phase1_ActiveTabReady) {
      this.currentPhase = StartupPhase.Phase1_ActiveTabReady;
      const span = StartupProfiler.start('phase1-active-tab-duration');
      try {
        for (const task of this.phase1Tasks) {
          try {
            const res = task.fn();
            if (res instanceof Promise) {
              await res;
            }
          } catch {
            StartupProfiler.increment('phase1-task-errors');
          }
        }
      } finally {
        StartupProfiler.finish(span);
      }
    } else if (phase === StartupPhase.Phase2_IdleBackground) {
      this.currentPhase = StartupPhase.Phase2_IdleBackground;
      for (const service of this.services.values()) {
        if (!service.isReady && !service.scheduledTaskId) {
          this.scheduleServiceOnIdle(service);
        }
      }
    }
  }

  async ensureService(serviceId: string): Promise<void> {
    if (this._isDisposed) return;

    const service = this.services.get(serviceId);
    if (!service || service.isReady) {
      return;
    }

    if (service.runningPromise) {
      await service.runningPromise;
      return;
    }

    StartupProfiler.increment('jit-promotion-count');

    if (service.scheduledTaskId) {
      await this.scheduler.promote(service.scheduledTaskId);
      service.isReady = true;
      return;
    }

    // If not scheduled yet, run directly
    const promise = (async () => {
      try {
        const res = service.fn();
        if (res instanceof Promise) {
          await res;
        }
      } finally {
        service.isReady = true;
        service.runningPromise = undefined;
      }
    })();

    service.runningPromise = promise;
    await promise;
  }

  dispose(): void {
    this._isDisposed = true;
    this.phase0Tasks = [];
    this.phase1Tasks = [];
    if (this.ownScheduler) {
      this.scheduler.dispose();
    }
    this.services.clear();
  }

  private scheduleServiceOnIdle(service: RegisteredServiceRecord): void {
    if (this._isDisposed || service.isReady || service.scheduledTaskId) {
      return;
    }

    const task: CooperativeTask = {
      id: service.id,
      name: service.name,
      priority: service.priority ?? 'idle',
      run: async (context) => {
        if (service.isReady || this._isDisposed) return;
        try {
          const res = service.fn(context);
          if (res instanceof Promise) {
            await res;
          }
        } finally {
          service.isReady = true;
        }
      },
    };

    service.scheduledTaskId = this.scheduler.schedule(task);
  }
}
