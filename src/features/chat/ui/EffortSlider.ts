import {
  getReasoningTint,
  normalizeReasoningOptions,
  orderReasoningOptions,
} from '../../../core/providers/reasoning';
import type { ProviderReasoningOption } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { createEffortMatrix, type EffortMatrixHandle } from './effortMatrix';

const DRAG_THRESHOLD_PX = 3;
const DETENT_RATIO = 0.8;
const FALLBACK_KNOB_WIDTH = 16;
/** Keeps a just-committed rung visible while settings round-trip back into the toolbar. */
const PENDING_ECHO_MS = 12_000;
/** Length of the label crossfade; mirrors --claudian-plus-effort-duration-move. */
const SWAP_DURATION_MS = 200;
const SWAP_FALLBACK_MS = SWAP_DURATION_MS + 16;


export interface EffortSliderSource {
  options: readonly ProviderReasoningOption[];
  value: string;
}

export interface EffortSliderOptions {
  read: () => EffortSliderSource;
  onCommit: (value: string) => void;
}

export interface EffortSlider {
  el: HTMLElement;
  update(): void;
  /** Drops a committed-but-unconfirmed rung so the next paint shows the persisted value. */
  cancelPending(): void;
  focus(): void;
  destroy(): void;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function requestFrame(callback: () => void): number {
  const raf = (window as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
  if (typeof raf === 'function') {
    return raf.call(window, callback);
  }
  return window.setTimeout(callback, 0);
}

/** Detent curve: the knob eases into each rung instead of sliding linearly. */
export function applyDetent(travel: number, segment: number): number {
  if (segment <= 0) {
    return travel;
  }
  const continuous = travel / segment;
  const index = Math.min(Math.floor(continuous), Math.max(0, Math.ceil(continuous) - 1));
  const t = continuous - index;
  return (index + t - (DETENT_RATIO * Math.sin(2 * Math.PI * t)) / (2 * Math.PI)) * segment;
}

export function createEffortSlider(
  parentEl: HTMLElement,
  options: EffortSliderOptions,
): EffortSlider {
  const root = parentEl.createDiv({ cls: 'claudian-plus-effort' });

  const head = root.createDiv({ cls: 'claudian-plus-effort-head' });
  head.createSpan({ cls: 'claudian-plus-effort-label', text: t('chat.effort.label') });
  const valueEl = head.createSpan({ cls: 'claudian-plus-effort-value' });
  const previewEl = head.createSpan({ cls: 'claudian-plus-effort-value-preview' });

  const ends = root.createDiv({ cls: 'claudian-plus-effort-ends' });
  ends.createSpan({ cls: 'claudian-plus-effort-end', text: t('chat.effort.faster') });
  ends.createSpan({ cls: 'claudian-plus-effort-end', text: t('chat.effort.stronger') });

  const track = root.createDiv({
    cls: 'claudian-plus-effort-track',
    attr: {
      role: 'slider',
      tabindex: '0',
      'aria-orientation': 'horizontal',
      'aria-label': t('chat.effort.label'),
    },
  });
  const fillEl = track.createDiv({ cls: 'claudian-plus-effort-fill' });
  const ticksEl = track.createDiv({ cls: 'claudian-plus-effort-ticks' });
  const matrixEl = track.createDiv({ cls: 'claudian-plus-effort-matrix' });
  const knobEl = track.createDiv({ cls: 'claudian-plus-effort-knob' });

  const matrix: EffortMatrixHandle = createEffortMatrix(track, matrixEl);

  // The toolbar is built before the view is laid out, so the first measurement is
  // zero width. Retry once the track actually has a width, and again on resize.
  const ensureMatrix = (): void => {
    if (root.getAttribute('data-apex') !== 'true') {
      return;
    }
    const built = matrix.ensure();
    if (!built && matrixEl.childElementCount === 0) {
      requestFrame(() => {
        if (root.getAttribute('data-apex') === 'true') {
          matrix.ensure();
        }
      });
    }
  };

  let matrixObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    matrixObserver = new ResizeObserver(() => ensureMatrix());
    matrixObserver.observe(track);
  }


  let steps: ProviderReasoningOption[] = [];
  let index = -1;
  let shownLabel = '';
  let swapTimer: number | null = null;
  let ticksSignature = '';
  let pressed = false;
  let dragging = false;
  let pressX = 0;
  let pointerX: number | null = null;
  let activePointerId: number | null = null;
  let pendingValue: string | null = null;
  let pendingUntil = 0;

  const ownerDocument = (): Document => track.ownerDocument ?? activeDocument;

  const trackWidth = (): number => {
    const measured = track.clientWidth || track.getBoundingClientRect?.().width || 0;
    return Number.isFinite(measured) ? measured : 0;
  };

  const knobWidth = (): number => knobEl.offsetWidth || FALLBACK_KNOB_WIDTH;

  const travelSpan = (): number => Math.max(0, trackWidth() - knobWidth());

  const travelForIndex = (target: number): number => {
    const span = travelSpan();
    if (steps.length <= 1 || target < 0) {
      return span;
    }
    return (target / (steps.length - 1)) * span;
  };

  const writeTravel = (travel: number): void => {
    const clamped = clamp(travel, 0, travelSpan());
    knobEl.setCssProps({ translate: `${clamped.toFixed(2)}px` });
    fillEl.setCssProps({ width: `${(clamped + knobWidth() / 2).toFixed(2)}px` });
  };

  const writeLabels = (base: string, preview: string): void => {
    valueEl.setText(base);
    previewEl.setText(preview);
    previewEl.setCssProps({ left: `${valueEl.offsetLeft || 0}px` });
  };

  const writeSwapProgress = (progress: number, direction: number): void => {
    root.setCssProps({
      '--claudian-plus-effort-swap-progress': progress.toFixed(3),
      '--claudian-plus-effort-swap-rest': (1 - progress).toFixed(3),
      '--claudian-plus-effort-swap-dir': String(direction),
    });
  };

  /** Folds a finished swap in place without animating. */
  const writeAtRest = (label: string): void => {
    shownLabel = label;
    root.setAttribute('data-swap-reset', 'true');
    writeLabels(label, label);
    writeSwapProgress(0, 1);
    void previewEl.offsetWidth;
    root.removeAttribute('data-swap-reset');
  };

  const clearSwapTimer = (): void => {
    if (swapTimer !== null) {
      window.clearTimeout(swapTimer);
      swapTimer = null;
    }
  };

  /** Crossfades the outgoing rung name into the incoming one. */
  const animateLabelTo = (label: string, direction: number): void => {
    if (!label || label === shownLabel) {
      return;
    }
    const from = shownLabel;
    shownLabel = label;
    clearSwapTimer();

    // A detached control has nothing to paint, and frames scheduled for it would
    // outlive the owner.
    if (root.isConnected !== true) {
      writeAtRest(label);
      return;
    }

    root.setAttribute('data-swap-reset', 'true');
    writeLabels(from, label);
    writeSwapProgress(0, direction);
    void previewEl.offsetWidth;
    root.removeAttribute('data-swap-reset');

    requestFrame(() => {
      if (shownLabel !== label) {
        return;
      }
      writeSwapProgress(1, direction);
      swapTimer = window.setTimeout(() => {
        swapTimer = null;
        if (shownLabel === label) {
          writeAtRest(label);
        }
      }, SWAP_FALLBACK_MS);
    });
  };

  const localTravel = (clientX: number): number => {
    const rect = track.getBoundingClientRect?.();
    const left = rect?.left ?? 0;
    const span = travelSpan();
    return clamp(clientX - left - knobWidth() / 2, 0, span);
  };

  const nearestIndex = (travel: number): number => {
    if (steps.length === 0) {
      return -1;
    }
    if (steps.length === 1) {
      return 0;
    }
    const span = travelSpan();
    if (span <= 0) {
      return index;
    }
    return clamp(Math.round((travel / span) * (steps.length - 1)), 0, steps.length - 1);
  };

  const paintState = (target: number = index): void => {
    const step = steps[target];
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(Math.max(0, steps.length - 1)));
    track.setAttribute('aria-valuenow', String(Math.max(0, target)));
    if (step) {
      track.setAttribute('aria-valuetext', step.label);
    } else {
      track.removeAttribute('aria-valuetext');
    }

    const apex = steps.length > 1 && target === steps.length - 1;
    root.toggleClass('is-apex', apex);
    if (apex) {
      root.setAttribute('data-apex', 'true');
      ensureMatrix();
    } else {
      root.removeAttribute('data-apex');
    }

    const empty = steps.length === 0;
    root.toggleClass('is-empty', empty);
    if (empty) {
      root.setAttribute('data-empty', 'true');
    } else {
      root.removeAttribute('data-empty');
    }

    const tint = getReasoningTint(target, steps.length);
    root.setCssProps({
      '--claudian-plus-effort-tint': tint === null ? '' : `${Math.round(tint * 100)}%`,
    });
  };

  const renderTicks = (): void => {
    const signature = `${steps.map(step => step.value).join('|')}:${Math.round(trackWidth())}`;
    if (signature === ticksSignature) {
      return;
    }
    ticksSignature = signature;
    ticksEl.empty();

    if (steps.length <= 1) {
      return;
    }

    const size = knobWidth();
    steps.forEach((step, stepIndex) => {
      const tick = ticksEl.createDiv({ cls: 'claudian-plus-effort-tick' });
      tick.setAttribute('title', step.label);
      tick.setCssProps({ left: `${(travelForIndex(stepIndex) + size / 2).toFixed(2)}px` });
    });
  };

  const commit = (next: number): void => {
    if (next < 0 || next >= steps.length) {
      return;
    }
    const direction = next > index ? 1 : -1;
    index = next;
    writeTravel(travelForIndex(index));
    paintState();
    animateLabelTo(steps[index].label, direction);
    pendingValue = steps[index].value;
    pendingUntil = Date.now() + PENDING_ECHO_MS;
    options.onCommit(steps[index].value);
  };

  function onDocumentPointerUp(): void {
    handlePointerUp();
  }

  const detachDocumentListener = (): void => {
    ownerDocument().removeEventListener?.('pointerup', onDocumentPointerUp as EventListener, true);
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();

    pressed = true;
    dragging = false;
    pressX = event.clientX;
    activePointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
    root.removeAttribute('data-dragging');
    pointerX = localTravel(event.clientX);
    writeTravel(pointerX);

    track.setPointerCapture?.(event.pointerId);
    ownerDocument().addEventListener?.('pointerup', onDocumentPointerUp as EventListener, true);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!pressed) {
      return;
    }
    if (!dragging) {
      if (Math.abs(event.clientX - pressX) < DRAG_THRESHOLD_PX) {
        return;
      }
      dragging = true;
      root.setAttribute('data-dragging', 'true');
    }

    const span = travelSpan();
    const segment = steps.length > 1 ? span / (steps.length - 1) : 0;
    pointerX = localTravel(event.clientX);
    writeTravel(applyDetent(pointerX, segment));

    const hovered = nearestIndex(pointerX);
    if (hovered !== index && hovered !== -1) {
      animateLabelTo(steps[hovered].label, hovered > index ? 1 : -1);
      paintState(hovered);
    }
  };

  const handlePointerUp = (): void => {
    if (!pressed) {
      return;
    }
    pressed = false;
    detachDocumentListener();
    if (activePointerId !== null) {
      track.releasePointerCapture?.(activePointerId);
      activePointerId = null;
    }
    if (dragging) {
      dragging = false;
      root.removeAttribute('data-dragging');
    }

    const travel = pointerX ?? travelForIndex(index);
    pointerX = null;
    const next = nearestIndex(travel);
    if (next !== index) {
      commit(next);
    } else {
      writeTravel(travelForIndex(index));
      paintState(index);
    }
  };

  const handlePointerCancel = (): void => {
    if (!pressed) {
      return;
    }
    pressed = false;
    dragging = false;
    root.removeAttribute('data-dragging');
    detachDocumentListener();
    pointerX = null;
    writeTravel(travelForIndex(index));
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (steps.length === 0) {
      return;
    }

    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = steps.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault?.();
    event.stopPropagation?.();
    const clamped = clamp(next, 0, steps.length - 1);
    if (clamped !== index) {
      commit(clamped);
    }
  };

  track.addEventListener('pointerdown', handlePointerDown as EventListener);
  track.addEventListener('pointermove', handlePointerMove as EventListener);
  track.addEventListener('pointerup', handlePointerUp as EventListener);
  track.addEventListener('pointercancel', handlePointerCancel as EventListener);
  track.addEventListener('keydown', handleKeyDown as EventListener);

  const update = (): void => {
    const source = options.read();
    steps = normalizeReasoningOptions(orderReasoningOptions(source.options));

    let nextIndex = steps.findIndex(step => step.value === source.value);
    if (nextIndex === -1) {
      nextIndex = steps.length > 0 ? 0 : -1;
    }

    if (pendingValue !== null) {
      const echoed = steps.findIndex(step => step.value === pendingValue);
      if (echoed !== -1 && Date.now() < pendingUntil && source.value !== pendingValue) {
        nextIndex = echoed;
      } else if (source.value === pendingValue || Date.now() >= pendingUntil) {
        pendingValue = null;
      }
    }

    index = nextIndex;
    clearSwapTimer();
    renderTicks();
    writeTravel(travelForIndex(index));
    paintState();
    writeAtRest(steps[index]?.label ?? '');
  };

  return {
    el: root,
    update,
    cancelPending(): void {
      if (pendingValue === null) {
        return;
      }
      pendingValue = null;
      update();
    },
    focus(): void {
      track.focus?.();
    },
    destroy(): void {
      clearSwapTimer();
      detachDocumentListener();
      matrixObserver?.disconnect();
      matrixObserver = null;
      matrix.dispose();
      track.removeEventListener('pointerdown', handlePointerDown as EventListener);
      track.removeEventListener('pointermove', handlePointerMove as EventListener);
      track.removeEventListener('pointerup', handlePointerUp as EventListener);
      track.removeEventListener('pointercancel', handlePointerCancel as EventListener);
      track.removeEventListener('keydown', handleKeyDown as EventListener);
      root.remove();
    },
  };
}
