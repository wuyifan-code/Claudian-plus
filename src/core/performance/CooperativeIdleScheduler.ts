export type TaskPriority = 'high' | 'normal' | 'idle';

export interface TaskContext {
  shouldYield: () => boolean;
  isCancelled: () => boolean;
  timeRemaining: () => number;
}

export interface CooperativeTask {
  id?: string;
  name: string;
  priority?: TaskPriority;
  run: (context: TaskContext) => Promise<void> | void;
  hasMoreWork?: () => boolean;
}

export interface CooperativeIdleSchedulerOptions {
  sliceDurationMs?: number;
  onError?: (error: unknown, task: CooperativeTask) => void;
}

interface QueuedTaskRecord {
  task: CooperativeTask;
  id: string;
  priority: TaskPriority;
  resolve?: () => void;
  reject?: (reason?: unknown) => void;
  cancelled: boolean;
}

const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  high: 0,
  normal: 1,
  idle: 2,
};

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type RequestIdleCallbackFn = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout?: number },
) => number;

export class CooperativeIdleScheduler {
  private sliceDurationMs: number;
  private onError?: (error: unknown, task: CooperativeTask) => void;
  private queue: QueuedTaskRecord[] = [];
  private completedCount = 0;
  private scheduledHandle: number | null = null;
  private isProcessing = false;
  private _isDisposed = false;
  private nextAutoId = 1;

  constructor(options: CooperativeIdleSchedulerOptions = {}) {
    this.sliceDurationMs = options.sliceDurationMs ?? 16;
    this.onError = options.onError;
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  getPendingCount(): number {
    return this.queue.filter((item) => !item.cancelled).length;
  }

  getCompletedCount(): number {
    return this.completedCount;
  }

  schedule(task: CooperativeTask): string {
    if (this._isDisposed) {
      throw new Error('Cannot schedule tasks on a disposed CooperativeIdleScheduler');
    }

    const id = task.id ?? `task-${this.nextAutoId++}`;
    const priority = task.priority ?? 'normal';

    const record: QueuedTaskRecord = {
      task,
      id,
      priority,
      cancelled: false,
    };

    this.queue.push(record);
    this.sortQueue();
    this.ensureScheduled();

    return id;
  }

  async promote(taskId: string): Promise<void> {
    if (this._isDisposed) return;

    const index = this.queue.findIndex((r) => r.id === taskId && !r.cancelled);
    if (index === -1) return;

    const [record] = this.queue.splice(index, 1);
    if (!record || record.cancelled) return;

    const res = this.executeTaskRecord(record, () => false, 1000);
    if (res && typeof (res as Promise<boolean>).then === 'function') {
      await res;
    }
  }

  cancel(taskId: string): boolean {
    const record = this.queue.find((r) => r.id === taskId && !r.cancelled);
    if (record) {
      record.cancelled = true;
      this.queue = this.queue.filter((r) => r.id !== taskId);
      return true;
    }
    return false;
  }

  dispose(): void {
    this._isDisposed = true;
    this.cancelScheduledHandle();
    this.queue.forEach((r) => {
      r.cancelled = true;
    });
    this.queue = [];
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => PRIORITY_WEIGHTS[a.priority] - PRIORITY_WEIGHTS[b.priority]);
  }

  private ensureScheduled(): void {
    if (this._isDisposed || this.scheduledHandle !== null || this.isProcessing) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    const hasIdleCallback = typeof window !== 'undefined' &&
      typeof (window as unknown as { requestIdleCallback?: RequestIdleCallbackFn }).requestIdleCallback === 'function';

    if (hasIdleCallback) {
      const ric = (window as unknown as { requestIdleCallback: RequestIdleCallbackFn }).requestIdleCallback;
      this.scheduledHandle = ric(
        (deadline) => {
          this.scheduledHandle = null;
          void this.processQueue(deadline);
        },
        { timeout: 100 },
      );
    } else {
      this.scheduledHandle = window.setTimeout(
        () => {
          this.scheduledHandle = null;
          const startTime = performance.now();
          void this.processQueue({
            didTimeout: false,
            timeRemaining: () => Math.max(0, this.sliceDurationMs - (performance.now() - startTime)),
          });
        },
        this.sliceDurationMs,
      );
    }
  }

  private cancelScheduledHandle(): void {
    if (this.scheduledHandle === null) return;

    const hasCancelIdleCallback = typeof window !== 'undefined' &&
      typeof (window as unknown as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback === 'function';

    if (hasCancelIdleCallback) {
      (window as unknown as { cancelIdleCallback: (handle: number) => void }).cancelIdleCallback(this.scheduledHandle);
    } else {
      window.clearTimeout(this.scheduledHandle);
    }
    this.scheduledHandle = null;
  }

  private async processQueue(deadline: IdleDeadlineLike): Promise<void> {
    if (this._isDisposed || this.isProcessing) return;

    this.isProcessing = true;
    const sliceStart = performance.now();

    try {
      while (this.queue.length > 0 && !this._isDisposed) {
        const record = this.queue[0];
        if (!record || record.cancelled) {
          this.queue.shift();
          continue;
        }

        const elapsed = performance.now() - sliceStart;
        if (elapsed >= this.sliceDurationMs && deadline.timeRemaining() <= 0 && this.completedCount > 0) {
          break; // time slice exhausted, yield to next frame
        }

        const shouldYield = () => {
          if (this._isDisposed || record.cancelled) return true;
          const now = performance.now();
          return (now - sliceStart) >= this.sliceDurationMs;
        };

        const timeRemaining = () => Math.max(0, this.sliceDurationMs - (performance.now() - sliceStart));

        const executionResult = this.executeTaskRecord(record, shouldYield, timeRemaining());
        const moreWork = typeof (executionResult as Promise<boolean>).then === 'function'
          ? await executionResult
          : executionResult as boolean;

        if (moreWork && !record.cancelled && !this._isDisposed) {
          // Task paused voluntarily via shouldYield(), break to resume on next idle slice
          break;
        } else {
          // Task completed, was cancelled, or errored
          const currentIdx = this.queue.indexOf(record);
          if (currentIdx !== -1) {
            this.queue.splice(currentIdx, 1);
          }
        }
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0 && !this._isDisposed) {
        this.ensureScheduled();
      }
    }
  }

  private executeTaskRecord(
    record: QueuedTaskRecord,
    shouldYield: () => boolean,
    remainingTime: number,
  ): boolean | Promise<boolean> {
    const context: TaskContext = {
      shouldYield,
      isCancelled: () => record.cancelled || this._isDisposed,
      timeRemaining: () => remainingTime,
    };

    try {
      const result = record.task.run(context);
      if (result instanceof Promise) {
        return result.then(
          () => {
            if (record.task.hasMoreWork && record.task.hasMoreWork()) {
              return true;
            }
            this.completedCount++;
            record.resolve?.();
            return false;
          },
          (err) => {
            this.completedCount++;
            record.reject?.(err);
            if (this.onError) {
              try {
                this.onError(err, record.task);
              } catch {
                // Ignore error in error handler
              }
            }
            return false;
          },
        );
      }

      if (record.task.hasMoreWork && record.task.hasMoreWork()) {
        return true;
      }

      this.completedCount++;
      record.resolve?.();
      return false;
    } catch (err) {
      this.completedCount++;
      record.reject?.(err);
      if (this.onError) {
        try {
          this.onError(err, record.task);
        } catch {
          // Ignore error in error handler
        }
      }
      return false;
    }
  }
}
