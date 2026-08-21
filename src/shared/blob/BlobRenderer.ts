import { BLOB_PATH, VIEWBOX } from './geometry';
import type { BlobFrame } from './types';

function polyToPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M${first[0].toFixed(2)} ${first[1].toFixed(2)}${rest.map((p) => `L${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('')}Z`;
}

export class BlobRenderer {
  private container: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private bodyPath: SVGPathElement | null = null;
  private eyeEls: SVGPathElement[] = [];
  private overlayEl: SVGCircleElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
    container.classList.add('claudian-plus-blob');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `${VIEWBOX.minX} ${VIEWBOX.minY} ${VIEWBOX.width} ${VIEWBOX.height}`);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.classList.add('claudian-plus-blob__svg');

    const body = document.createElementNS(ns, 'path');
    body.setAttribute('d', BLOB_PATH);
    body.classList.add('claudian-plus-blob__body');
    svg.appendChild(body);
    this.bodyPath = body;

    const eyesG = document.createElementNS(ns, 'g');
    eyesG.classList.add('claudian-plus-blob__eyes');
    for (let i = 0; i < 2; i++) {
      const eye = document.createElementNS(ns, 'path');
      eye.classList.add('claudian-plus-blob__eye');
      eyesG.appendChild(eye);
      this.eyeEls.push(eye);
    }
    svg.appendChild(eyesG);

    const overlay = document.createElementNS(ns, 'circle');
    overlay.setAttribute('cx', `${114}`);
    overlay.setAttribute('cy', `${114}`);
    overlay.setAttribute('r', '18');
    overlay.classList.add('claudian-plus-blob__overlay');
    svg.appendChild(overlay);
    this.overlayEl = overlay;

    container.appendChild(svg);
    this.svg = svg;
  }

  render(frame: BlobFrame): void {
    if (!this.bodyPath || this.eyeEls.length === 0) return;
    // Scale/rotation applied via container transform for simplicity
    if (this.svg) {
      this.svg.style.transform = `scale(${frame.scale}) rotate(${frame.rotation}deg)`;
    }
    // Eye rendering: frame.eye.vertices is for one eye; for two eyes we use pair from EYES
    // If frame.eye contains single eye vertices, duplicate for both; otherwise expect pair handling outside
    const eyePath = polyToPath(frame.eye.vertices);
    for (const el of this.eyeEls) {
      el.setAttribute('d', eyePath);
    }
    // Overlay visibility
    if (this.overlayEl) {
      const visible = frame.overlay !== 'none';
      this.overlayEl.style.opacity = visible ? '0.9' : '0';
      // Use token accent for overlay; class already sets stroke to var(--claudian-plus-accent)
      this.overlayEl.style.display = visible ? '' : 'none';
    }
  }

  // Convenience for rendering with raw eye indices (for preview)
  renderEyes(left: [number, number][], right: [number, number][]): void {
    if (this.eyeEls.length >= 2) {
      this.eyeEls[0].setAttribute('d', polyToPath(left));
      this.eyeEls[1].setAttribute('d', polyToPath(right));
    }
  }

  unmount(): void {
    if (this.container && this.svg) {
      this.container.removeChild(this.svg);
      this.container.classList.remove('claudian-plus-blob');
    }
    this.container = null;
    this.svg = null;
    this.bodyPath = null;
    this.eyeEls = [];
    this.overlayEl = null;
  }
}
