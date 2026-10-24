import { IdleActivityObserver } from '@/core/memory/IdleActivityObserver';

interface MockApp {
  workspace: {
    on: jest.Mock;
    offref: jest.Mock;
  };
  vault: {
    on: jest.Mock;
  };
}

function createMockApp(): {
  app: MockApp;
  emitWorkspace: (event: string, ...args: unknown[]) => void;
  emitVault: (event: string, ...args: unknown[]) => void;
} {
  const workspaceHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const vaultHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

  const app: MockApp = {
    workspace: {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        const list = workspaceHandlers.get(event) ?? [];
        list.push(cb);
        workspaceHandlers.set(event, list);
        return { event };
      }),
      offref: jest.fn(),
    },
    vault: {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        const list = vaultHandlers.get(event) ?? [];
        list.push(cb);
        vaultHandlers.set(event, list);
        return { event };
      }),
    },
  };

  return {
    app,
    emitWorkspace: (event, ...args) => {
      for (const cb of workspaceHandlers.get(event) ?? []) cb(...args);
    },
    emitVault: (event, ...args) => {
      for (const cb of vaultHandlers.get(event) ?? []) cb(...args);
    },
  };
}

describe('IdleActivityObserver', () => {
  const MINUTE = 60 * 1000;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accumulates touched files without emitting before the idle threshold', () => {
    const { app, emitWorkspace, emitVault } = createMockApp();
    let clock = Date.now();
    const onIdleObservation = jest.fn();
    const observer = new IdleActivityObserver({
      app: app as never,
      onIdleObservation,
      idleThresholdMs: 15 * MINUTE,
      checkIntervalMs: MINUTE,
      now: () => clock,
    });
    observer.start();

    emitWorkspace('file-open', { path: 'a.md' });
    emitWorkspace('file-open', { path: 'b.md' });
    emitVault('modify', { path: 'a.md' });
    clock += 5 * MINUTE;
    jest.advanceTimersByTime(MINUTE);

    expect(observer.touchedFileCount()).toBe(2);
    expect(onIdleObservation).not.toHaveBeenCalled();

    observer.stop();
  });

  it('emits one summary after the idle window with enough activity', () => {
    const { app, emitWorkspace, emitVault } = createMockApp();
    let clock = Date.now();
    const onIdleObservation = jest.fn();
    const observer = new IdleActivityObserver({
      app: app as never,
      onIdleObservation,
      idleThresholdMs: 15 * MINUTE,
      checkIntervalMs: MINUTE,
      now: () => clock,
    });
    observer.start();

    emitWorkspace('file-open', { path: 'a.md' });
    emitWorkspace('file-open', { path: 'b.md' });
    emitVault('modify', { path: 'a.md' });

    clock += 16 * MINUTE;
    jest.advanceTimersByTime(MINUTE);

    expect(onIdleObservation).toHaveBeenCalledTimes(1);
    const summary = onIdleObservation.mock.calls[0][0] as string;
    expect(summary).toContain('a.md');
    expect(summary).toContain('edited');
    expect(summary).toContain('b.md');

    // State resets; a second check without new activity emits nothing.
    clock += 16 * MINUTE;
    jest.advanceTimersByTime(MINUTE);
    expect(onIdleObservation).toHaveBeenCalledTimes(1);

    observer.stop();
  });

  it('respects the enabled kill-switch and clears activity', () => {
    const { app, emitWorkspace } = createMockApp();
    let clock = Date.now();
    let enabled = false;
    const onIdleObservation = jest.fn();
    const observer = new IdleActivityObserver({
      app: app as never,
      onIdleObservation,
      idleThresholdMs: MINUTE,
      checkIntervalMs: MINUTE,
      isEnabled: () => enabled,
      now: () => clock,
    });
    observer.start();

    emitWorkspace('file-open', { path: 'a.md' });
    emitWorkspace('file-open', { path: 'b.md' });
    clock += 2 * MINUTE;
    jest.advanceTimersByTime(MINUTE);

    expect(onIdleObservation).not.toHaveBeenCalled();
    expect(observer.touchedFileCount()).toBe(0);

    enabled = true;
    observer.stop();
  });

  it('stops polling and unregisters events on stop', () => {
    const { app } = createMockApp();
    const observer = new IdleActivityObserver({
      app: app as never,
      onIdleObservation: jest.fn(),
      checkIntervalMs: MINUTE,
    });
    observer.start();
    observer.stop();

    expect(app.workspace.offref).toHaveBeenCalled();
    expect(observer.touchedFileCount()).toBe(0);
  });
});
