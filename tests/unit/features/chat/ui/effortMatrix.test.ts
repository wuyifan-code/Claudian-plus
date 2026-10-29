import { createMockEl } from '@test/helpers/mockElement';

import {
  cellFade,
  cellUnit,
  createEffortMatrix,
  solveMatrixGeometry,
} from '@/features/chat/ui/effortMatrix';

describe('effort matrix geometry', () => {
  it('solves a five-row whole-pixel grid', () => {
    const geometry = solveMatrixGeometry(320, 1);

    expect(geometry).not.toBeNull();
    expect(geometry?.rows).toBe(5);
    expect(geometry?.blockCss).toBe(4);
    expect(geometry?.gapCss).toBe(1);
    expect(geometry?.columns).toBe(Math.floor((320 + 1) / (4 + 1)));
  });

  it('never shrinks a square below three device pixels', () => {
    const geometry = solveMatrixGeometry(320, 1);
    expect((geometry?.blockCss ?? 0) * 1).toBeGreaterThanOrEqual(3);
  });

  it('returns null when the track has not been laid out', () => {
    expect(solveMatrixGeometry(0, 1)).toBeNull();
    expect(solveMatrixGeometry(Number.NaN, 1)).toBeNull();
  });

  it('falls back to dpr 1 when the ratio is invalid', () => {
    expect(solveMatrixGeometry(320, 0)?.blockCss).toBe(4);
  });
});

describe('effort matrix cells', () => {
  it('dissolves the left edge and saturates the right edge', () => {
    expect(cellFade(0)).toBe(0);
    expect(cellFade(0.05)).toBe(0);
    expect(cellFade(0.75)).toBe(1);
    expect(cellFade(1)).toBe(1);
  });

  it('is monotonic across the ramp', () => {
    const samples = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.8, 1].map(cellFade);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1]);
    }
  });

  it('produces a deterministic scatter in [0, 1)', () => {
    const first = cellUnit(3, 7, 6);
    expect(cellUnit(3, 7, 6)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
    expect(cellUnit(3, 8, 6)).not.toBe(first);
  });
});

describe('createEffortMatrix', () => {
  function withWidth(width: number): any {
    const track = createMockEl();
    track.clientWidth = width;
    return track;
  }

  afterEach(() => {
    delete (globalThis as { matchMedia?: unknown }).matchMedia;
  });

  it('fills the matrix with five rows of squares', () => {
    const track = withWidth(240);
    const matrix = createMockEl();
    const handle = createEffortMatrix(track, matrix);

    expect(handle.ensure()).toBe(true);

    const geometry = solveMatrixGeometry(240, 1);
    expect(matrix.children.length).toBe((geometry?.columns ?? 0) * 5);

    // Obsidian forwards setCssProps keys verbatim to style.setProperty, so the
    // grid must be expressed in kebab-case or the squares collapse to zero size.
    expect(matrix.style['grid-template-columns']).toContain('repeat(');
    expect(matrix.style['grid-auto-rows']).toBe('4px');

    const firstCell = matrix.children[0];
    const lastCell = matrix.children[(geometry?.columns ?? 1) - 1];
    expect(firstCell.children[0].style.opacity).toBe('0.000');
    expect(lastCell.children[0].style.opacity).toBe('1.000');
    expect(firstCell.children[0].hasClass('claudian-plus-effort-matrix-sq')).toBe(true);
  });

  it('reuses the grid when the width is unchanged', () => {
    const track = withWidth(240);
    const matrix = createMockEl();
    const handle = createEffortMatrix(track, matrix);

    expect(handle.ensure()).toBe(true);
    expect(handle.ensure()).toBe(false);
    expect(matrix.children.length).toBeGreaterThan(0);
  });

  it('rebuilds when the width changes', () => {
    const track = withWidth(240);
    const matrix = createMockEl();
    const handle = createEffortMatrix(track, matrix);

    handle.ensure();
    const before = matrix.children.length;
    track.clientWidth = 320;

    expect(handle.ensure()).toBe(true);
    expect(matrix.children.length).toBeGreaterThan(before);
  });

  it('does not build before layout', () => {
    const track = withWidth(0);
    const matrix = createMockEl();

    expect(createEffortMatrix(track, matrix).ensure()).toBe(false);
    expect(matrix.children.length).toBe(0);
  });

  it('writes per-cell timing so the shimmer is staggered', () => {
    const track = withWidth(240);
    const matrix = createMockEl();
    createEffortMatrix(track, matrix).ensure();

    const columns = solveMatrixGeometry(240, 1)?.columns ?? 1;
    const first = matrix.children[0].children[0];
    const last = matrix.children[columns - 1].children[0];

    expect(first.style['--claudian-plus-effort-flow-delay']).toMatch(/^-\d+ms$/);
    expect(first.style['--claudian-plus-effort-flash-duration']).toMatch(/ms$/);
    expect(first.style['--claudian-plus-effort-flash-delay']).toMatch(/ms$/);
    expect(first.style['--claudian-plus-effort-flow-strength']).toBeDefined();
    expect(first.style['--claudian-plus-effort-flow-delay'])
      .not.toBe(last.style['--claudian-plus-effort-flow-delay']);
  });
});
