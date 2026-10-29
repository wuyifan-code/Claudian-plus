/**
 * Pixel-matrix backdrop for the effort slider apex state.
 *
 * The grid is solved in device pixels so every square lands on a whole pixel at
 * any zoom level: a fractional block size would blur the 1px gaps into a grey
 * wash instead of readable dots.
 */

const MATRIX_ROWS = 5;
const MATRIX_TRACK_HEIGHT_CSS = 26;
const MIN_BLOCK_DEVICE_PX = 3;
const FADE_START = 0.05;
const FADE_END = 0.75;
const FLOW_CLUSTERS = 9;
const FLOW_SMOOTHSTEP_LOW = 0.46;
const FLOW_SMOOTHSTEP_HIGH = 0.58;
const FLOW_BASE_STRENGTH = 0.16;
const FLOW_RANGE_STRENGTH = 0.78;
/** Flash period; each square runs a slightly different duration inside this cycle. */
const PERIOD_FLASH_MS = 1450;
/** Flow period; the visible pulse occupies only the first 6% of it. */
const PERIOD_FLOW_MS = 4000;

export interface EffortMatrixGeometry {
  rows: number;
  columns: number;
  blockCss: number;
  gapCss: number;
  paddingXPx: number;
  paddingYPx: number;
}

export interface EffortMatrixHandle {
  /** Rebuilds when the track width, DPR, or motion preference changed. */
  ensure(): boolean;
  dispose(): void;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Resolves the square grid for a track width, or null when it cannot be measured yet. */
export function solveMatrixGeometry(
  trackWidthCss: number,
  devicePixelRatio: number,
): EffortMatrixGeometry | null {
  if (!Number.isFinite(trackWidthCss) || trackWidthCss <= 0) {
    return null;
  }

  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  const gap = Math.max(1, Math.round(dpr));
  const margin = Math.max(1, Math.round(0.5 * dpr));
  const heightDevice = Math.round(MATRIX_TRACK_HEIGHT_CSS * dpr);
  const widthDevice = Math.round(trackWidthCss * dpr);

  const block = Math.max(
    MIN_BLOCK_DEVICE_PX,
    Math.floor((heightDevice - 2 * margin - (MATRIX_ROWS - 1) * gap) / MATRIX_ROWS),
  );
  const columns = Math.max(1, Math.floor((widthDevice + gap) / (block + gap)));

  const contentWidth = columns * block + (columns - 1) * gap;
  const contentHeight = MATRIX_ROWS * block + (MATRIX_ROWS - 1) * gap;

  return {
    rows: MATRIX_ROWS,
    columns,
    blockCss: block / dpr,
    gapCss: gap / dpr,
    paddingXPx: Math.max(0, (widthDevice - contentWidth) / 2) / dpr,
    paddingYPx: Math.max(0, (heightDevice - contentHeight) / 2) / dpr,
  };
}

/** Left-to-right dissolve: fully transparent at the left edge, solid from 75% on. */
export function cellFade(fraction: number): number {
  if (fraction <= FADE_START) {
    return 0;
  }
  if (fraction >= FADE_END) {
    return 1;
  }
  return smoothstep(FADE_START, FADE_END, fraction);
}

/** Deterministic scatter so the twinkle pattern is stable across rebuilds. */
export function cellUnit(a: number, b: number, seed: number): number {
  let hash = Math.imul(a + 0x9e3779b9, 0x85ebca6b)
    ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
    ^ Math.imul(seed + 0x27d4eb2f, 0x165667b1);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2545f491);
  hash ^= hash >>> 13;
  return (hash >>> 0) / 0x100000000;
}

function ms(value: number): string {
  return `${Math.round(value)}ms`;
}

export function createEffortMatrix(
  track: HTMLElement,
  matrixEl: HTMLElement,
): EffortMatrixHandle {
  let signature: string | null = null;

  const measureWidth = (): number => {
    const measured = track.clientWidth || track.getBoundingClientRect?.().width || 0;
    return Number.isFinite(measured) ? measured : 0;
  };

  const build = (widthCss: number, dpr: number): boolean => {
    const geometry = solveMatrixGeometry(widthCss, dpr);
    if (!geometry) {
      return false;
    }

    matrixEl.empty();
    // Obsidian's setCssProps forwards keys verbatim to style.setProperty, which
    // drops camelCase names; the grid geometry must be spelled in kebab-case.
    const geometryProps: Record<string, string> = {
      'grid-template-columns': `repeat(${geometry.columns}, ${geometry.blockCss}px)`,
      'grid-auto-rows': `${geometry.blockCss}px`,
      gap: `${geometry.gapCss}px`,
      padding: `${geometry.paddingYPx}px ${geometry.paddingXPx}px`,
    };
    matrixEl.setCssProps(geometryProps);

    for (let row = 0; row < geometry.rows; row += 1) {
      for (let column = 0; column < geometry.columns; column += 1) {
        const fraction = geometry.columns > 1
          ? column / (geometry.columns - 1)
          : 1;
        const cluster = Math.min(FLOW_CLUSTERS - 1, Math.floor(fraction * FLOW_CLUSTERS));

        const flashUnit = cellUnit(row, column, 1);
        const durationUnit = cellUnit(row, column, 3);
        const frontUnit = cellUnit(row, column, 4);
        const flowUnit = cellUnit(row, column, 5);
        const coarse = cellUnit(cluster, row, 6);
        const fine = cellUnit(row, column, 7);

        const flowStrength = FLOW_BASE_STRENGTH
          + smoothstep(FLOW_SMOOTHSTEP_LOW, FLOW_SMOOTHSTEP_HIGH, coarse * 0.4 + fine * 0.6)
          * FLOW_RANGE_STRENGTH;

        const frontDelay = PERIOD_FLASH_MS * ((1 - fraction) * 0.31 + 0.055 * frontUnit);
        const flowDelay = -PERIOD_FLOW_MS * (fraction + 0.03 * row + 0.05 * flowUnit);

        const cell = matrixEl.createDiv({ cls: 'claudian-plus-effort-matrix-cell' });
        const square = cell.createDiv({ cls: 'claudian-plus-effort-matrix-sq' });

        square.setCssProps({ opacity: cellFade(fraction).toFixed(3) });

        cell.setCssProps({
          '--claudian-plus-effort-cell-delay': ms(frontDelay),
        });
        square.setCssProps({
          '--claudian-plus-effort-flash-duration': ms(PERIOD_FLASH_MS * (0.92 + 0.16 * durationUnit)),
          '--claudian-plus-effort-flash-delay': ms(PERIOD_FLASH_MS * (0.21 + 0.95 * cellUnit(row, column, 2))),
          '--claudian-plus-effort-flash-mix': `${(62 - flashUnit * 22).toFixed(1)}%`,
          '--claudian-plus-effort-front-delay': ms(frontDelay),
          '--claudian-plus-effort-flow-delay': ms(flowDelay),
          '--claudian-plus-effort-flow-strength': flowStrength.toFixed(3),
        });
      }
    }

    return true;
  };

  return {
    ensure(): boolean {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = measureWidth();
      const nextSignature = `${Math.round(width * dpr)}:${dpr}`;

      if (nextSignature === signature) {
        return false;
      }

      signature = nextSignature;
      if (!build(width, dpr)) {
        signature = null;
        return false;
      }
      return true;
    },

    dispose(): void {
      signature = null;
      matrixEl.empty();
    },
  };
}
