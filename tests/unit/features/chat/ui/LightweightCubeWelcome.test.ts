/** @jest-environment jsdom */

import { LightweightCubeWelcome } from '@/features/chat/ui/LightweightCubeWelcome';

function createMock2dContext(): Record<string, jest.Mock> {
  const context: Record<string, jest.Mock> = {};
  for (const method of [
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'fill',
    'arc',
    'clearRect',
    'closePath',
    'save',
    'restore',
    'scale',
    'translate',
    'setTransform',
    'fillRect',
    'ellipse',
    'createRadialGradient',
  ]) {
    context[method] = jest.fn();
  }
  return context;
}

describe('LightweightCubeWelcome', () => {
  let mockContext: Record<string, jest.Mock>;
  let rafCallbacks: Array<() => void>;
  let rafSpy: jest.SpyInstance;
  let cafSpy: jest.SpyInstance;

  beforeEach(() => {
    document.body.className = '';
    document.documentElement.className = '';
    delete document.body.dataset.theme;
    delete document.documentElement.dataset.theme;
    document.body.style.removeProperty('--background-primary');

    mockContext = createMock2dContext();
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: jest.fn().mockReturnValue(mockContext),
    });

    rafCallbacks = [];
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        rafCallbacks.push(() => callback(Date.now()));
        return rafCallbacks.length;
      });
    cafSpy = jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {});

    // jsdom lacks ResizeObserver; the welcome cube must degrade gracefully.
    delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a wrapper and canvas with the shared welcome classes', () => {
    const parentEl = document.createElement('div');
    const welcome = new LightweightCubeWelcome(parentEl);

    const wrapper = parentEl.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toContain('claudian-plus-welcome-cube-wrapper');
    expect(wrapper.className).toContain('claudian-plus-welcome-cube-wrapper--lite');
    const canvas = wrapper.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.className).toContain('claudian-plus-welcome-cube-canvas');

    welcome.destroy();
  });

  it('starts the animation loop and renders a frame', () => {
    const parentEl = document.createElement('div');
    const welcome = new LightweightCubeWelcome(parentEl);

    expect(rafSpy).toHaveBeenCalled();
    expect(mockContext.beginPath).toHaveBeenCalled();

    welcome.destroy();
  });

  it('uses the dark palette when Obsidian is in dark mode', () => {
    document.body.classList.add('theme-dark');
    const parentEl = document.createElement('div');
    const welcome = new LightweightCubeWelcome(parentEl);
    const palette = (welcome as unknown as { getPalette(): Record<string, string> }).getPalette();

    expect(palette).toBeDefined();
    expect(palette.dot).not.toBe(palette.line);

    welcome.destroy();
  });

  it('switches palette when the Obsidian theme changes', async () => {
    document.body.classList.add('theme-light');
    const parentEl = document.createElement('div');
    const welcome = new LightweightCubeWelcome(parentEl);
    const initial = (welcome as unknown as { isLightMode: boolean }).isLightMode;
    expect(initial).toBe(true);

    document.body.classList.replace('theme-light', 'theme-dark');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = (welcome as unknown as { isLightMode: boolean }).isLightMode;
    expect(after).toBe(false);

    welcome.destroy();
  });

  it('pauses the animation loop and resumes it later', () => {
    const parentEl = document.createElement('div');
    const welcome = new LightweightCubeWelcome(parentEl);

    const framesBeforePause = rafCallbacks.length;
    expect(framesBeforePause).toBeGreaterThan(0);

    welcome.pause();
    const framesAfterPause = rafCallbacks.length;
    rafCallbacks.slice(framesAfterPause).forEach((callback) => callback());

    welcome.resume();
    expect(rafCallbacks.length).toBeGreaterThan(framesAfterPause);

    welcome.destroy();
  });

  it('pausing twice is idempotent and does not resume on second pause', () => {
    const parentEl = document.createElement('div');
    const welcome = new LightweightCubeWelcome(parentEl);

    welcome.pause();
    const pausedFrameCount = rafCallbacks.length;
    welcome.pause();
    expect(rafCallbacks.length).toBe(pausedFrameCount);

    welcome.destroy();
  });

  it('destroy cancels the animation frame and removes the wrapper', () => {
    const parentEl = document.createElement('div');
    const welcome = new LightweightCubeWelcome(parentEl);
    const wrapper = parentEl.firstElementChild as HTMLElement;
    const removeSpy = jest.spyOn(wrapper, 'remove');

    welcome.destroy();

    expect(cafSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect((welcome as unknown as { isDestroyed: boolean }).isDestroyed).toBe(true);
  });

  it('destroy is idempotent', () => {
    const parentEl = document.createElement('div');
    const welcome = new LightweightCubeWelcome(parentEl);

    welcome.destroy();
    welcome.destroy();

    expect(cafSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the animation loop running across multiple frames', () => {
    const parentEl = document.createElement('div');
    const welcome = new LightweightCubeWelcome(parentEl);

    const initialFrames = rafCallbacks.length;
    for (let i = 0; i < 3; i += 1) {
      const callback = rafCallbacks[rafCallbacks.length - 1];
      callback();
    }

    expect(rafCallbacks.length).toBeGreaterThan(initialFrames);

    welcome.destroy();
  });

  it('degrades gracefully when getContext returns null', () => {
    (HTMLCanvasElement.prototype.getContext as jest.Mock).mockReturnValue(null);
    const parentEl = document.createElement('div');

    expect(() => new LightweightCubeWelcome(parentEl)).not.toThrow();

    // Animation loop still runs; rendering is skipped silently.
    const welcome = new LightweightCubeWelcome(parentEl);
    expect(rafSpy).toHaveBeenCalled();
    welcome.destroy();
  });
});
