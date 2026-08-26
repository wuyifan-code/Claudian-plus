import { CooperativeIdleScheduler } from '@/core/performance/CooperativeIdleScheduler';

describe('CooperativeIdleScheduler', () => {
  let scheduler: CooperativeIdleScheduler;

  beforeEach(() => {
    jest.useFakeTimers();
    scheduler = new CooperativeIdleScheduler({ sliceDurationMs: 16 });
  });

  afterEach(() => {
    scheduler.dispose();
    jest.useRealTimers();
  });

  it('schedules and executes a single task', async () => {
    const executed: string[] = [];
    scheduler.schedule({
      id: 'task-1',
      name: 'Task 1',
      run: () => {
        executed.push('task-1');
      },
    });

    expect(scheduler.getPendingCount()).toBe(1);
    expect(executed).toEqual([]);

    jest.advanceTimersByTime(20);
    await Promise.resolve();

    expect(executed).toEqual(['task-1']);
    expect(scheduler.getPendingCount()).toBe(0);
    expect(scheduler.getCompletedCount()).toBe(1);
  });

  it('executes tasks respecting priority order (high before normal before idle)', async () => {
    const executed: string[] = [];
    scheduler.schedule({
      id: 'idle-task',
      name: 'Idle Task',
      priority: 'idle',
      run: () => { executed.push('idle'); },
    });
    scheduler.schedule({
      id: 'high-task',
      name: 'High Task',
      priority: 'high',
      run: () => { executed.push('high'); },
    });
    scheduler.schedule({
      id: 'normal-task',
      name: 'Normal Task',
      priority: 'normal',
      run: () => { executed.push('normal'); },
    });

    jest.advanceTimersByTime(20);
    await Promise.resolve();

    expect(executed).toEqual(['high', 'normal', 'idle']);
  });

  it('supports cooperative yielding across time slices', async () => {
    const steps: number[] = [];
    let currentStep = 0;

    scheduler.schedule({
      id: 'long-task',
      name: 'Long Task',
      run: (context) => {
        while (currentStep < 5) {
          steps.push(currentStep);
          currentStep++;
          if (context.shouldYield()) {
            return; // pause and yield for next frame
          }
        }
      },
      hasMoreWork: () => currentStep < 5,
    });

    // Mock shouldYield to simulate exhausting the 16ms budget after 2 steps
    let callCount = 0;
    const originalNow = performance.now;
    performance.now = jest.fn(() => {
      callCount++;
      return callCount * 10; // each step takes 10ms
    });

    try {
      jest.advanceTimersByTime(20);
      await Promise.resolve();

      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps.length).toBeLessThan(5);

      // Advance timers across enough slices for full completion
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(steps).toEqual([0, 1, 2, 3, 4]);
    } finally {
      performance.now = originalNow;
    }
  });

  it('promotes task for immediate JIT execution', async () => {
    const executed: string[] = [];
    scheduler.schedule({
      id: 'low-priority',
      name: 'Low Priority',
      priority: 'idle',
      run: () => { executed.push('low'); },
    });
    scheduler.schedule({
      id: 'deferred-provider',
      name: 'Deferred Provider',
      priority: 'idle',
      run: () => { executed.push('deferred-provider'); },
    });

    expect(executed).toEqual([]);

    // JIT promote the deferred provider task
    const promise = scheduler.promote('deferred-provider');
    await promise;

    expect(executed).toContain('deferred-provider');
    expect(executed).not.toContain('low');

    // Remaining idle tasks run later
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    expect(executed).toEqual(['deferred-provider', 'low']);
  });

  it('cancels pending task', () => {
    const executed: string[] = [];
    const taskId = scheduler.schedule({
      name: 'Cancel Me',
      run: () => { executed.push('should-not-run'); },
    });

    expect(scheduler.getPendingCount()).toBe(1);
    const cancelled = scheduler.cancel(taskId);
    expect(cancelled).toBe(true);
    expect(scheduler.getPendingCount()).toBe(0);

    jest.advanceTimersByTime(50);
    expect(executed).toEqual([]);
  });

  it('isolates errors so single task failure does not crash the queue', async () => {
    const errors: unknown[] = [];
    const executed: string[] = [];

    scheduler = new CooperativeIdleScheduler({
      onError: (err) => { errors.push(err); },
    });

    scheduler.schedule({
      id: 'failing-task',
      name: 'Failing Task',
      run: () => {
        throw new Error('Background failure');
      },
    });
    scheduler.schedule({
      id: 'subsequent-task',
      name: 'Subsequent Task',
      run: () => {
        executed.push('success');
      },
    });

    jest.advanceTimersByTime(50);
    await Promise.resolve();

    expect(errors.length).toBe(1);
    expect((errors[0] as Error).message).toBe('Background failure');
    expect(executed).toEqual(['success']);
  });

  it('disposes cleanly and cancels all timers', () => {
    const executed: string[] = [];
    scheduler.schedule({
      name: 'Task After Dispose',
      run: () => { executed.push('nope'); },
    });

    scheduler.dispose();
    expect(scheduler.isDisposed).toBe(true);
    expect(scheduler.getPendingCount()).toBe(0);

    jest.advanceTimersByTime(100);
    expect(executed).toEqual([]);
  });
});
