import { BlobController } from './BlobController';
import { lerpPoly } from './BlobEyeMorph';
import { getOverlayForState } from './BlobOverlays';
import { BlobRenderer } from './BlobRenderer';
import { createSpring, stepSpring } from './BlobSpring';
import { BlobStateMachine } from './BlobStateMachine';
import { EYES } from './geometry';
import type { BlobEvent, BlobState } from './types';

const STATE_EYE: Record<BlobState, number> = {
  idle: 0,
  listening: 10,
  thinking: 8,
  writing: 15,
  error: 7,
  celebrate: 2,
};

// Eye playlist per state (from grok_bot-icon-study replica/src/tables.js EYE_PLAYLIST)
const EYE_PLAYLIST: Record<BlobState, number[]> = {
  idle: [0, 8],
  listening: [10, 1, 19],
  thinking: [8, 16, 14, 17, 5],
  writing: [15, 9],
  error: [7, 16],
  celebrate: [2, 8, 17],
};

const EYE_HOLD_MS: Record<BlobState, [number, number]> = {
  idle: [2200, 3800],
  listening: [2800, 5000],
  thinking: [2000, 3600],
  writing: [2500, 4200],
  error: [1800, 3200],
  celebrate: [1400, 2600],
};

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

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
  let eyePlaylistIdx = 0;
  const eyeSpring = createSpring(7, 1, 1, 1); // stiffness 7 as in GrokCharacter._morphEyes
  eyeSpring.t = 1;
  eyeSpring.x = 1;

  const scaleSpring = createSpring(5, 0.9, 1, 1);
  scaleSpring.t = 1;
  const squashSpring = createSpring(10, 0.8, 1, 1);
  squashSpring.t = 1;
  squashSpring.x = 1;
  const txSpring = createSpring(3.5, 1, 1, 0);
  const tySpring = createSpring(4, 1, 1, 0);
  const rotSpring = createSpring(5, 0.9, 1, 0);

  let eyeUntil = performance.now() + rand(...(EYE_HOLD_MS[machine.state] ?? [2200, 3800]));
  let blinkUntil = performance.now() + rand(3200, 7000);
  let isBlinking = false;
  let blinkEnd = 0;
  let blinkProgress = 0;

  const controller = new BlobController(container, (dt) => {
    const now = performance.now();
    const dtSec = dt / 1000;
    const state = machine.state;

    // Eye playlist cycling within state
    if (now >= eyeUntil) {
      const playlist = EYE_PLAYLIST[state] ?? [STATE_EYE[state]];
      eyePlaylistIdx = (eyePlaylistIdx + 1) % playlist.length;
      const nextIdx = playlist[eyePlaylistIdx];
      if (nextIdx !== targetEyeIdx) {
        currentEyeIdx = targetEyeIdx;
        targetEyeIdx = nextIdx;
        eyeSpring.x = 0;
        eyeSpring.v = 0;
        eyeSpring.t = 1;
      }
      const hold = EYE_HOLD_MS[state] ?? [2200, 3800];
      eyeUntil = now + rand(hold[0], hold[1]);
    }

    // Blink
    if (!isBlinking && now >= blinkUntil) {
      isBlinking = true;
      blinkEnd = now + 120;
      blinkUntil = now + rand(3000, 7000);
    }
    if (isBlinking) {
      if (now >= blinkEnd) {
        isBlinking = false;
        blinkProgress = 0;
      } else {
        const p = (now - (blinkEnd - 120)) / 120;
        blinkProgress = p < 0.5 ? p * 2 : 2 - p * 2; // 0->1->0
      }
    }

    // Step springs
    stepSpring(eyeSpring, 7, 1, dtSec);
    // Lively params per state
    if (state === 'idle') {
      scaleSpring.t = 1 + Math.sin(now * 0.0009) * 0.025;
      squashSpring.t = 1 + Math.sin(now * 0.0013 + 1) * 0.035;
      txSpring.t = Math.sin(now * 0.0007) * 2.2;
      tySpring.t = Math.cos(now * 0.0006) * 1.8;
      rotSpring.t = Math.sin(now * 0.0005) * 2.5;
    } else if (state === 'listening') {
      scaleSpring.t = 1 + Math.sin(now * 0.0012) * 0.018;
      squashSpring.t = 1;
      txSpring.t = Math.sin(now * 0.001) * 1.5;
      tySpring.t = 0;
      rotSpring.t = Math.sin(now * 0.0008) * 1.2;
    } else if (state === 'thinking') {
      scaleSpring.t = 1 + Math.sin(now * 0.002) * 0.045;
      squashSpring.t = 1 + Math.cos(now * 0.0018) * 0.05;
      txSpring.t = Math.sin(now * 0.0015) * 3.5;
      tySpring.t = Math.cos(now * 0.0011) * 2.2;
      rotSpring.t = Math.sin(now * 0.001) * 3;
    } else if (state === 'writing') {
      scaleSpring.t = 1 + Math.sin(now * 0.003) * 0.03;
      squashSpring.t = 1;
      txSpring.t = Math.sin(now * 0.0025) * 1.8;
      tySpring.t = Math.sin(now * 0.002) * 1.2;
      rotSpring.t = Math.sin(now * 0.0015) * 1.5;
    } else if (state === 'celebrate') {
      scaleSpring.t = 1 + Math.sin(now * 0.005) * 0.08;
      squashSpring.t = 1 + Math.cos(now * 0.004) * 0.06;
      rotSpring.t = Math.sin(now * 0.005) * 8;
      txSpring.t = 0;
      tySpring.t = Math.sin(now * 0.004) * -2;
    } else if (state === 'error') {
      scaleSpring.t = 1;
      squashSpring.t = 1 + Math.sin(now * 0.01) * 0.04;
      txSpring.t = (Math.random() - 0.5) * 0.8;
      tySpring.t = 0;
      rotSpring.t = Math.sin(now * 0.02) * 1.5;
    } else {
      scaleSpring.t = 1;
      squashSpring.t = 1;
      txSpring.t = 0;
      tySpring.t = 0;
      rotSpring.t = 0;
    }
    stepSpring(scaleSpring, 5, 0.9, dtSec);
    stepSpring(squashSpring, 10, 0.8, dtSec);
    stepSpring(txSpring, 3.5, 1, dtSec);
    stepSpring(tySpring, 4, 1, dtSec);
    stepSpring(rotSpring, 5, 0.9, dtSec);

    const t = eyeSpring.x;
    const cur = EYES[currentEyeIdx];
    const tgt = EYES[targetEyeIdx];
    // lerp both eyes
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    let left = lerpPoly(cur[0] as [number, number][], tgt[0] as [number, number][], t);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    let right = lerpPoly(cur[1] as [number, number][], tgt[1] as [number, number][], t);
    // Apply blink: squash y
    if (blinkProgress > 0) {
      const squashY = 1 - blinkProgress * 0.92;
      const applyBlink = (pts: [number, number][]): [number, number][] => {
        if (pts.length === 0) return pts;
        let cy = 0;
        for (const p of pts) cy += p[1];
        cy /= pts.length;
        return pts.map(([x, y]) => [x, cy + (y - cy) * squashY]);
      };
      left = applyBlink(left);
      right = applyBlink(right);
    }
    renderer.renderEyes(left, right);

    // Apply transform via renderer container
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const svg = container.querySelector('.claudian-plus-blob__svg') as HTMLElement | null;
    if (svg) {
      const sx = scaleSpring.x;
      const sy = squashSpring.x;
      const tx = txSpring.x;
      const ty = tySpring.x;
      const rot = rotSpring.x + (state === 'celebrate' ? Math.sin(now * 0.005) * 8 : 0);
      svg.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`;
      // eslint-disable-next-line obsidianmd/no-static-styles-assignment
      svg.style.transformOrigin = '50% 50%';
    }

    // Overlay handling via class or opacity
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
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
  renderer.renderEyes(initEyes[0], initEyes[1]);

  return {
    setEvent(event: BlobEvent) {
      const prev = machine.state;
      machine.dispatch(event);
      const next = machine.state;
      if (next !== prev) {
        currentEyeIdx = targetEyeIdx;
        const playlist = EYE_PLAYLIST[next] ?? [STATE_EYE[next] ?? 0];
        eyePlaylistIdx = 0;
        targetEyeIdx = playlist[0];
        eyeSpring.x = 0;
        eyeSpring.v = 0;
        eyeSpring.t = 1;
        eyeUntil = performance.now() + rand(...(EYE_HOLD_MS[next] ?? [2200, 3800]));
      }
    },
    setState(state: BlobState) {
      const prev = machine.state;
      // Force state via internal assignment for preview control
      (machine as unknown as { _state: BlobState })._state = state;
      if (state !== prev) {
        currentEyeIdx = targetEyeIdx;
        const playlist = EYE_PLAYLIST[state] ?? [STATE_EYE[state] ?? 0];
        eyePlaylistIdx = 0;
        targetEyeIdx = playlist[0];
        eyeSpring.x = 0;
        eyeSpring.v = 0;
        eyeSpring.t = 1;
        eyeUntil = performance.now() + rand(...(EYE_HOLD_MS[state] ?? [2200, 3800]));
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
