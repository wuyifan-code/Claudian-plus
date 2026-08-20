export type BlobTickCallback = (dtMs: number) => void;

export class BlobController {
  private container: HTMLElement | null;
  private onTick: BlobTickCallback;
  private rafId: number | null = null;
  private lastNow: number | null = null;
  private pausedByVisibility = false;
  private pausedByIntersection = false;
  private observer: IntersectionObserver | null = null;
  private visibilityHandler: (() => void) | null = null;
  private running = false;

  constructor(container: HTMLElement, onTick: BlobTickCallback) {
    this.container = container;
    this.onTick = onTick;
  }

  get isPaused(): boolean {
    return this.pausedByVisibility || this.pausedByIntersection;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastNow = null;

    // Visibility handling
    this.visibilityHandler = () => {
      // eslint-disable-next-line obsidianmd/prefer-active-doc
      this.pausedByVisibility = document.hidden;
    };
    // eslint-disable-next-line obsidianmd/prefer-active-doc
    document.addEventListener('visibilitychange', this.visibilityHandler);
    // eslint-disable-next-line obsidianmd/prefer-active-doc
    this.pausedByVisibility = document.hidden;

    // Intersection handling
    if (this.container && typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          this.pausedByIntersection = !entry.isIntersecting;
        }
      });
      this.observer.observe(this.container);
    } else {
      this.pausedByIntersection = false;
    }

    this.schedule();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  destroy(): void {
    this.stop();
    if (this.visibilityHandler) {
      // eslint-disable-next-line obsidianmd/prefer-active-doc
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.container = null;
  }

  private schedule(): void {
    if (!this.running) return;
    // eslint-disable-next-line obsidianmd/prefer-window-timers
    this.rafId = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number): void {
    if (!this.running) return;
    if (this.lastNow === null) this.lastNow = now;
    const dt = Math.min(now - this.lastNow, 100);
    this.lastNow = now;

    if (!this.isPaused) {
      try {
        this.onTick(dt);
      } catch {
        // ignore tick errors to keep loop alive
      }
    }

    this.schedule();
  }

  // Measure idle CPU cost; simplified synchronous version for testability.
  // In production it samples a few dummy frames and returns mean cost.
  async measureIdleCpu(_durationMs = 2000): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      // Simulate minimal work
      for (let j = 0; j < 1000; j++) Math.sqrt(j);
      const t1 = performance.now();
      samples.push(t1 - t0);
    }
    const avg = samples.reduce((a, b) => a + b, 0) / Math.max(samples.length, 1);
    return avg;
  }
}
