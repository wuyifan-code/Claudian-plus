import { CooperativeIdleScheduler } from '@/core/performance/CooperativeIdleScheduler';
import { StagedStartupCoordinator, StartupPhase } from '@/core/performance/StagedStartupCoordinator';
import { StartupProfiler } from '@/core/performance/StartupProfiler';

describe('StagedStartupCoordinator', () => {
  let scheduler: CooperativeIdleScheduler;
  let coordinator: StagedStartupCoordinator;

  beforeEach(() => {
    jest.useFakeTimers();
    StartupProfiler.reset();
    scheduler = new CooperativeIdleScheduler({ sliceDurationMs: 16 });
    coordinator = new StagedStartupCoordinator({ scheduler });
  });

  afterEach(() => {
    coordinator.dispose();
    scheduler.dispose();
    jest.useRealTimers();
  });

  it('starts at Uninitialized phase and advances sequentially through phases', async () => {
    expect(coordinator.getCurrentPhase()).toBe(StartupPhase.Uninitialized);

    const phase0Events: string[] = [];
    coordinator.registerPhase0Task('mount-shell', () => {
      phase0Events.push('mounted');
    });

    await coordinator.advanceToPhase(StartupPhase.Phase0_ShellReady);
    expect(coordinator.getCurrentPhase()).toBe(StartupPhase.Phase0_ShellReady);
    expect(phase0Events).toEqual(['mounted']);

    const phase1Events: string[] = [];
    coordinator.registerPhase1Task('restore-active-tab', () => {
      phase1Events.push('tab-restored');
    });

    await coordinator.advanceToPhase(StartupPhase.Phase1_ActiveTabReady);
    expect(coordinator.getCurrentPhase()).toBe(StartupPhase.Phase1_ActiveTabReady);
    expect(phase1Events).toEqual(['tab-restored']);

    const idleEvents: string[] = [];
    coordinator.registerIdleTask('dream-service', 'Dream Service', () => {
      idleEvents.push('dream-warmed');
    });

    await coordinator.advanceToPhase(StartupPhase.Phase2_IdleBackground);
    expect(coordinator.getCurrentPhase()).toBe(StartupPhase.Phase2_IdleBackground);

    // Idle tasks are deferred to scheduler
    expect(idleEvents).toEqual([]);
    jest.advanceTimersByTime(50);
    await Promise.resolve();

    expect(idleEvents).toEqual(['dream-warmed']);
    expect(coordinator.isServiceReady('dream-service')).toBe(true);
  });

  it('supports JIT promotion for services requested before idle phase execution', async () => {
    const readyServices: string[] = [];

    coordinator.registerIdleTask('claude-provider', 'Claude Provider Registration', () => {
      readyServices.push('claude-provider');
    });
    coordinator.registerIdleTask('semantic-index', 'Semantic Index Warmup', () => {
      readyServices.push('semantic-index');
    });

    await coordinator.advanceToPhase(StartupPhase.Phase1_ActiveTabReady);
    await coordinator.advanceToPhase(StartupPhase.Phase2_IdleBackground);

    expect(coordinator.isServiceReady('claude-provider')).toBe(false);

    // User switches tab to Claude -> JIT promotion triggers
    await coordinator.ensureService('claude-provider');

    expect(coordinator.isServiceReady('claude-provider')).toBe(true);
    expect(readyServices).toEqual(['claude-provider']);
    expect(coordinator.isServiceReady('semantic-index')).toBe(false);

    // Later idle slices process the remaining tasks
    jest.advanceTimersByTime(50);
    await Promise.resolve();

    expect(coordinator.isServiceReady('semantic-index')).toBe(true);
    expect(readyServices).toEqual(['claude-provider', 'semantic-index']);
  });

  it('records startup spans and JIT metrics in StartupProfiler', async () => {
    coordinator.registerPhase0Task('p0-work', () => {});
    coordinator.registerPhase1Task('p1-work', () => {});
    coordinator.registerIdleTask('jit-svc', 'JIT Service', () => {});

    await coordinator.advanceToPhase(StartupPhase.Phase0_ShellReady);
    await coordinator.advanceToPhase(StartupPhase.Phase1_ActiveTabReady);
    await coordinator.advanceToPhase(StartupPhase.Phase2_IdleBackground);

    await coordinator.ensureService('jit-svc');

    const report = StartupProfiler.getReport();
    const spanNames = report.spans.map(s => s.name);

    expect(spanNames).toContain('phase0-shell-duration');
    expect(spanNames).toContain('phase1-active-tab-duration');
    expect(report.counts['jit-promotion-count']).toBe(1);
  });

  it('isolates errors during phase task execution without breaking subsequent phases', async () => {
    coordinator.registerPhase0Task('broken-p0', () => {
      throw new Error('P0 error');
    });
    coordinator.registerPhase0Task('healthy-p0', () => {});

    // Should not throw and halt startup
    await coordinator.advanceToPhase(StartupPhase.Phase0_ShellReady);
    expect(coordinator.getCurrentPhase()).toBe(StartupPhase.Phase0_ShellReady);

    const report = StartupProfiler.getReport();
    expect(report.counts['phase0-task-errors']).toBe(1);
  });

  it('disposes cleanly and cancels queued background tasks', async () => {
    const executed: string[] = [];
    coordinator.registerIdleTask('pending-idle', 'Pending Idle', () => {
      executed.push('idle');
    });

    await coordinator.advanceToPhase(StartupPhase.Phase2_IdleBackground);
    coordinator.dispose();

    jest.advanceTimersByTime(100);
    await Promise.resolve();

    expect(executed).toEqual([]);
    expect(coordinator.isDisposed).toBe(true);
  });
});
