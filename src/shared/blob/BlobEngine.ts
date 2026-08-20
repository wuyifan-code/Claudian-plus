import { BlobStateMachine } from './BlobStateMachine';
import { createSpring, stepSpring } from './BlobSpring';
import { EYES } from './geometry';
import { lerpPoly } from './BlobEyeMorph';
import { getOverlayForState } from './BlobOverlays';
import { BlobRenderer } from './BlobRenderer';
import { BlobController } from './BlobController';
import type { BlobEvent, BlobState } from './types';

const STATE_EYE: Record<BlobState, number> = {
  idle: 0,
  listening: 10,
  thinking: 8,
  writing: 15,
  error: 7,
  celebrate: 2,
};

export interface BlobEngine {
  setEvent(event: BlobEvent): void;
  setState(state: BlobState): void;
  setSize(size: 'small' | 'large'): void;
  destroy(): void;
  measureIdleCpu(ms?: number): Promise<number>;
  getState(): BlobState;
}

export function createBlobEngine(container: HTMLElement, opts?: { size?: 'small' | 'large'; initialState?: BlobState }): BlobEngine {
  const machine = new BlobStateMachine(opts?.initialState ?? 'idle');
  const renderer = new BlobRenderer();
  renderer.mount(container);
  if (opts?.size === 'small') container.classList.add('claudian-plus-blob--small');

  let currentEyeIdx = STATE_EYE[machine.state];
  let targetEyeIdx = currentEyeIdx;
  const eyeSpring = createSpring(7, 1, 1, 1); // stiffness 7 as in GrokCharacter._morphEyes
  eyeSpring.t = 1;
  eyeSpring.x = 1;

  let scaleSpring = createSpring(5, 0.9, 1, 1);
  scaleSpring.t = 1;

  const controller = new BlobController(container, (dt) => {
    const dtSec = dt / 1000;
    // Step eye morph spring toward 1
    stepSpring(eyeSpring, 7, 1, dtSec);
    // Simple scale pulse for idle/listening
    const state = machine.state;
    if (state === 'idle') {
      scaleSpring.t = 1 + Math.sin(performance.now() * 0.001) * 0.02;
    } else if (state === 'thinking') {
      scaleSpring.t = 1 + Math.sin(performance.now() * 0.002) * 0.04;
    } else {
      scaleSpring.t = 1;
    }
    stepSpring(scaleSpring, 5, 0.9, dtSec);

    const t = eyeSpring.x;
    const cur = EYES[currentEyeIdx];
    const tgt = EYES[targetEyeIdx];
    // lerp both eyes
    const left = lerpPoly(cur[0] as [number, number][], tgt[0] as [number, number][], t);
    const right = lerpPoly(cur[1] as [number, number][], tgt[1] as [number, number][], t);
    renderer.renderEyes(left, right);

    // Apply scale/rotation via renderer container transform
    // Use scaleSpring for subtle breathing
    const svg = (container.querySelector('.claudian-plus-blob__svg') as HTMLElement | null);
    if (svg) {
      const rot = state === 'celebrate' ? Math.sin(performance.now() * 0.005) * 8 : 0;
      svg.style.transform = `scale(${scaleSpring.x.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`;
      svg.style.transformOrigin = '50% 50%';
    }

    // Overlay handling via class or opacity
    const overlay = container.querySelector('.claudian-plus-blob__overlay') as HTMLElement | null;
    if (overlay) {
      const kind = getOverlayForState(state);
      overlay.style.display = kind === 'none' ? 'none' : '';
      overlay.style.opacity = kind === 'none' ? '0' : '0.9';
    }
  });

  controller.start();

  // Initial render
  const initEyes = EYES[currentEyeIdx];
  renderer.renderEyes(initEyes[0] as [number, number][], initEyes[1] as [number, number][]);

  return {
    setEvent(event: BlobEvent) {
      const prev = machine.state;
      machine.dispatch(event);
      const next = machine.state;
      if (next !== prev) {
        currentEyeIdx = targetEyeIdx;
        targetEyeIdx = STATE_EYE[next] ?? 0;
        eyeSpring.x = 0;
        eyeSpring.v = 0;
        eyeSpring.t = 1;
      }
    },
    setState(state: BlobState) {
      const prev = machine.state;
      // Force state via dispatch loop or direct? Use internal
      // @ts-ignore access private for testing
      (machine as unknown as { _state: BlobState })._state = state;
      if (state !== prev) {
        currentEyeIdx = targetEyeIdx;
        targetEyeIdx = STATE_EYE[state] ?? 0;
        eyeSpring.x = 0;
        eyeSpring.v = 0;
        eyeSpring.t = 1;
      }
    },
    setSize(size: 'small' | 'large') {
      if (size === 'small') container.classList.add('claudian-plus-blob--small');
      else container.classList.remove('claudian-plus-blob--small');
    },
    destroy() {
      controller.destroy();
      renderer.unmount();
    },
    measureIdleCpu(ms?: number) {
      return controller.measureIdleCpu(ms);
    },
    getState() {
      return machine.state;
    },
  };
}
