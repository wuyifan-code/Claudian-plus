import { getObsidianTheme, observeObsidianTheme } from './obsidianTheme';

const GRID = [-1.1, 0, 1.1];
const EDGE_THRESHOLD = 1.2;
const FOCAL = 5.2;
const ZOOM = 42;

interface Palette {
  dot: string;
  line: string;
  orbit: string;
}

const DARK_PALETTE: Palette = {
  dot: 'rgba(247,249,255,0.85)',
  line: 'rgba(158,184,255,0.28)',
  orbit: 'rgba(108,134,206,0.5)',
};

const LIGHT_PALETTE: Palette = {
  dot: 'rgba(36,40,51,0.8)',
  line: 'rgba(51,69,111,0.2)',
  orbit: 'rgba(82,98,129,0.4)',
};

/**
 * Lightweight 2D-Canvas welcome animation. Renders the same 3x3x3 point
 * constellation as the Three.js cube through a simple perspective projection,
 * with no external dependencies, WebGL, or GPU state to manage.
 */
export class LightweightCubeWelcome {
  private wrapper: HTMLElement;
  private canvas: HTMLCanvasElement;
  private readonly ownerDocument: Document;
  private readonly ownerWindow: Window;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly points: { x: number; y: number; z: number }[] = [];
  private readonly edges: [number, number][] = [];

  private isLightMode: boolean;
  private rotationY = 0;
  private rotationX = -0.32;
  private animFrameId: number | null = null;
  private isPaused = false;
  private isDestroyed = false;
  private cleanupEvents: (() => void)[] = [];

  constructor(parentEl: HTMLElement) {
    this.wrapper = parentEl.createDiv({ cls: 'claudian-plus-welcome-cube-wrapper claudian-plus-welcome-cube-wrapper--lite' });
    this.ownerDocument = this.wrapper.ownerDocument;
    this.ownerWindow = this.ownerDocument.defaultView ?? window;
    this.canvas = this.wrapper.createEl('canvas', { cls: 'claudian-plus-welcome-cube-canvas' });

    const ctx = this.canvas.getContext('2d');
    this.context = ctx === null ? null : ctx;

    this.isLightMode = getObsidianTheme(this.ownerDocument) === 'light';

    this.buildGeometry();
    this.cleanupEvents.push(observeObsidianTheme(this.ownerDocument, (theme) => {
      this.isLightMode = theme === 'light';
      if (this.isPaused) this.draw();
    }));

    const ResizeObserverCtor = (this.ownerWindow as Window & {
      ResizeObserver?: typeof ResizeObserver;
    }).ResizeObserver;
    if (ResizeObserverCtor) {
      const resizeObserver = new ResizeObserverCtor(() => this.draw());
      resizeObserver.observe(this.wrapper);
      this.cleanupEvents.push(() => resizeObserver.disconnect());
    }

    this.draw();
    this.animate(this.ownerWindow.performance.now());
  }

  /** Test surface: current color palette. */
  private getPalette(): Palette {
    return this.isLightMode ? LIGHT_PALETTE : DARK_PALETTE;
  }

  private buildGeometry(): void {
    for (const x of GRID) {
      for (const y of GRID) {
        for (const z of GRID) {
          if (x === 0 && y === 0 && z === 0) continue;
          this.points.push({ x, y, z });
        }
      }
    }

    for (let i = 0; i < this.points.length; i += 1) {
      for (let j = i + 1; j < this.points.length; j += 1) {
        const a = this.points[i];
        const b = this.points[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance <= EDGE_THRESHOLD) {
          this.edges.push([i, j]);
        }
      }
    }
  }

  /** Projects a grid point through the current rotation into canvas space. */
  private project(point: { x: number; y: number; z: number }): { x: number; y: number } | null {
    const cosY = Math.cos(this.rotationY);
    const sinY = Math.sin(this.rotationY);
    const cosX = Math.cos(this.rotationX);
    const sinX = Math.sin(this.rotationX);

    const rx = point.x * cosY + point.z * sinY;
    const rz = -point.x * sinY + point.z * cosY;
    const ry = point.y * cosX - rz * sinX;
    const rz2 = point.y * sinX + rz * cosX;

    const perspective = FOCAL / (FOCAL + rz2 + 2.8);
    const width = this.canvas.clientWidth || 200;
    const height = this.canvas.clientHeight || 200;
    return {
      x: width / 2 + rx * perspective * ZOOM,
      y: height / 2 + ry * perspective * ZOOM,
    };
  }

  private draw(): void {
    if (this.isDestroyed || !this.context) return;

    const { context } = this;
    const palette = this.getPalette();
    const width = this.canvas.clientWidth || 200;
    const height = this.canvas.clientHeight || 200;
    context.clearRect(0, 0, width, height);

    const projected = this.points.map((point) => this.project(point));

    // Orbit rings rotate in the projected plane for a quiet ambient drift.
    context.strokeStyle = palette.orbit;
    context.lineWidth = 1;
    for (let ring = 0; ring < 2; ring += 1) {
      const radius = 88 + ring * 26;
      const stretch = ring === 0 ? 0.62 : 0.8;
      context.beginPath();
      context.ellipse(width / 2, height / 2, radius, radius * stretch, 0.12 + ring * 0.5, 0, Math.PI * 2);
      context.stroke();
    }

    // Constellation edges.
    context.strokeStyle = palette.line;
    context.beginPath();
    for (const [i, j] of this.edges) {
      const a = projected[i];
      const b = projected[j];
      if (!a || !b) continue;
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
    }
    context.stroke();

    // Points with a soft glow in dark mode.
    for (const projectedPoint of projected) {
      if (!projectedPoint) continue;
      context.fillStyle = palette.dot;
      context.beginPath();
      context.arc(projectedPoint.x, projectedPoint.y, 1.6, 0, Math.PI * 2);
      context.fill();
    }
  }

  private animate(now: number): void {
    if (this.isDestroyed || this.isPaused) return;
    this.animFrameId = this.ownerWindow.requestAnimationFrame((t) => this.animate(t));

    this.rotationY += 0.0042;
    this.draw();
    void now;
  }

  /** Stops the animation loop while preserving the last rendered frame. */
  pause(): void {
    if (this.isDestroyed || this.isPaused) return;
    this.isPaused = true;
    if (this.animFrameId !== null) {
      this.ownerWindow.cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /** Resumes the animation loop. */
  resume(): void {
    if (this.isDestroyed || !this.isPaused) return;
    this.isPaused = false;
    this.animate(this.ownerWindow.performance.now());
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    if (this.animFrameId !== null) {
      this.ownerWindow.cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    for (const cleanup of this.cleanupEvents) {
      cleanup();
    }
    this.cleanupEvents = [];
    this.wrapper.remove();
  }
}
