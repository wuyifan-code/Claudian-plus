/**
 * @jest-environment jsdom
 */

import { BlobController } from '@/shared/blob/BlobController';

describe('BlobController', () => {
  let container: HTMLElement;
  let tick: jest.Mock;
  let mockObserve: jest.Mock;
  let mockUnobserve: jest.Mock;
  let mockDisconnect: jest.Mock;
  let intersectionCallback: IntersectionObserverCallback;
  let intersectionObserverInstance: IntersectionObserver;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    tick = jest.fn();

    // Mock IntersectionObserver
    mockObserve = jest.fn();
    mockUnobserve = jest.fn();
    mockDisconnect = jest.fn();
    global.IntersectionObserver = jest.fn((cb: IntersectionObserverCallback) => {
      intersectionCallback = cb;
      intersectionObserverInstance = {
        observe: mockObserve,
        unobserve: mockUnobserve,
        disconnect: mockDisconnect,
        takeRecords: jest.fn(),
        root: null,
        rootMargin: '',
        thresholds: [],
      } as unknown as IntersectionObserver;
      return intersectionObserverInstance;
    }) as unknown as typeof IntersectionObserver;

    jest.useFakeTimers();
    // Mock rAF
    let rafId = 0;
    const rafMap = new Map<number, FrameRequestCallback>();
    global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      rafId += 1;
      rafMap.set(rafId, cb);
      return rafId;
    }) as unknown as typeof requestAnimationFrame;
    global.cancelAnimationFrame = jest.fn((id: number) => {
      rafMap.delete(id);
    }) as unknown as typeof cancelAnimationFrame;
    // Helper to trigger rAF
    (global as unknown as { __triggerRaf: (now: number) => void }).__triggerRaf = (now: number) => {
      const cbs = Array.from(rafMap.values());
      rafMap.clear();
      cbs.forEach((cb) => cb(now));
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    container.remove();
    delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it('starts and calls tick on rAF', () => {
    const c = new BlobController(container, tick);
    c.start();
    expect(mockObserve).toHaveBeenCalledWith(container);
    // Trigger rAF
    (global as unknown as { __triggerRaf: (now: number) => void }).__triggerRaf(1000);
    expect(tick).toHaveBeenCalled();
    c.destroy();
  });

  it('pauses when document.hidden', () => {
    const c = new BlobController(container, tick);
    c.start();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    (global as unknown as { __triggerRaf: (now: number) => void }).__triggerRaf(2000);
    // tick should not be called when hidden (paused)
    const callsBefore = tick.mock.calls.length;
    (global as unknown as { __triggerRaf: (now: number) => void }).__triggerRaf(3000);
    expect(tick.mock.calls.length).toBe(callsBefore);
    // Restore
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    (global as unknown as { __triggerRaf: (now: number) => void }).__triggerRaf(4000);
    expect(tick).toHaveBeenCalled();
    c.destroy();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('pauses when not intersecting', () => {
    const c = new BlobController(container, tick);
    c.start();
    // Simulate not intersecting
    intersectionCallback([{ isIntersecting: false } as IntersectionObserverEntry], intersectionObserverInstance);
    expect(c.isPaused).toBe(true);
    (global as unknown as { __triggerRaf: (now: number) => void }).__triggerRaf(1000);
    const calls = tick.mock.calls.length;
    (global as unknown as { __triggerRaf: (now: number) => void }).__triggerRaf(2000);
    expect(tick.mock.calls.length).toBe(calls);
    // Intersecting resumes
    intersectionCallback([{ isIntersecting: true } as IntersectionObserverEntry], intersectionObserverInstance);
    expect(c.isPaused).toBe(false);
    c.destroy();
  });

  it('remove listeners on destroy', () => {
    const c = new BlobController(container, tick);
    c.start();
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    c.destroy();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('start/stop are idempotent', () => {
    const c = new BlobController(container, tick);
    c.start();
    c.start();
    expect(mockObserve).toHaveBeenCalledTimes(1);
    c.stop();
    c.stop();
    // After stop, rAF should be cancelled
    expect(global.cancelAnimationFrame).toHaveBeenCalled();
    c.destroy();
  });

  it('measureIdleCpu returns mean frame cost', async () => {
    const c = new BlobController(container, tick);
    c.start();
    // Mock performance.now to increment
    let now = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => {
      now += 1;
      return now;
    });
    const cost = await c.measureIdleCpu(20);
    expect(typeof cost).toBe('number');
    expect(cost).toBeGreaterThanOrEqual(0);
    c.destroy();
  });
});
