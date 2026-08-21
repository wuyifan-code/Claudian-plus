import { getActiveDocument } from '../../utils/obsidianCompat';
import { BlobController } from './BlobController';
import { lerpPoly } from './BlobEyeMorph';
import { calcSquash, mapToSmallCircle } from './BlobFollow';
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
// Expanded to show full 25-eye variety; welcome idle cycles through all eyes for liveliness
const EYE_PLAYLIST: Record<BlobState, number[]> = {
  idle: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
  listening: [10, 1, 19, 3, 15, 0, 8, 2, 11],
  thinking: [8, 16, 14, 17, 5, 3, 21, 9, 15, 12, 18, 0, 2, 11],
  writing: [15, 9, 8, 16, 10, 1, 19, 3, 21],
  error: [7, 16, 3, 21, 14, 5, 2, 8],
  celebrate: [2, 8, 17, 11, 19, 15, 3, 21, 0, 24, 13],
};

const EYE_HOLD_MS: Record<BlobState, [number, number]> = {
  idle: [1200, 2200],
  listening: [1400, 2800],
  thinking: [900, 1800],
  writing: [1000, 2000],
  error: [1000, 2000],
  celebrate: [800, 1600],
};

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function eyeForAngle(angle: number): number {
  // 8-sector mapping of 25 eyes to directions, chosen for distinct expressions
  // angle in radians, 0 = right, PI/2 = down, PI = left, -PI/2 = up (screen coords y down)
  const deg = ((angle * 180) / Math.PI + 360) % 360;
  if (deg >= 337.5 || deg < 22.5) return 10; // right
  if (deg >= 22.5 && deg < 67.5) return 15; // down-right
  if (deg >= 67.5 && deg < 112.5) return 3; // down
  if (deg >= 112.5 && deg < 157.5) return 7; // down-left
  if (deg >= 157.5 && deg < 202.5) return 1; // left
  if (deg >= 202.5 && deg < 247.5) return 13; // up-left (sleepy)
  if (deg >= 247.5 && deg < 292.5) return 8; // up
  return 2; // up-right (happy)
}

export interface BlobEngine {
  setEvent(event: BlobEvent): void;
  setState(state: BlobState): void;
  setSize(size: 'small' | 'large'): void;
  destroy(): void;
  measureIdleCpu(ms?: number): Promise<number>;
  getState(): BlobState;
}

export function createBlobEngine(
  container: HTMLElement,
  opts?: { size?: 'small' | 'large'; initialState?: BlobState; followPointer?: boolean },
): BlobEngine {
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

  const followPointer = opts?.followPointer ?? false;
  let pointerX = 0;
  let pointerY = 0;
  let hasPointer = false;
  let pointerHandler: ((e: PointerEvent) => void) | null = null;
  let leaveHandler: (() => void) | null = null;
  if (followPointer && typeof window !== 'undefined') {
    pointerHandler = (e: PointerEvent) => {
      // Follow only when pointer is above the input (full-width area)
      // Find input wrapper to determine threshold; fallback to window center
      const inputEl = (getActiveDocument() ?? document).querySelector('.claudian-plus-input-wrapper');
      const inputTop = inputEl?.getBoundingClientRect().top ?? window.innerHeight * 0.7;
      if (e.clientY > inputTop) {
        hasPointer = false;
        pointerX = 0;
        pointerY = 0;
        return;
      }
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const mapped = mapToSmallCircle(dx * 0.06, dy * 0.06, 6);
      pointerX = mapped.x;
      pointerY = mapped.y;
      hasPointer = true;
    };
    leaveHandler = () => {
      hasPointer = false;
      pointerX = 0;
      pointerY = 0;
    };
    window.addEventListener('pointermove', pointerHandler, { passive: true });
    window.addEventListener('pointerleave', leaveHandler);
    (getActiveDocument() ?? document).addEventListener('pointerleave', leaveHandler);
  }

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

    // Follow pointer expression: eyes follow mouse direction (overrides playlist)
    if (followPointer && hasPointer) {
      const dist = Math.hypot(pointerX, pointerY);
      if (dist > 0.8) {
        const angle = Math.atan2(pointerY, pointerX);
        const nextEye = eyeForAngle(angle);
        if (nextEye !== targetEyeIdx) {
          currentEyeIdx = targetEyeIdx;
          targetEyeIdx = nextEye;
          eyeSpring.x = 0;
          eyeSpring.v = 0;
          eyeSpring.t = 1;
          eyeUntil = now + rand(...(EYE_HOLD_MS[state] ?? [1200, 2200]));
        }
      }
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
    // Follow pointer overrides (welcome large only, above input, 6px clamp)
    if (followPointer && hasPointer) {
      txSpring.t = pointerX;
      tySpring.t = pointerY;
      const dist = Math.hypot(pointerX, pointerY);
      squashSpring.t = 1 + calcSquash(dist);
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
    let left = lerpPoly(cur[0], tgt[0], t);
    let right = lerpPoly(cur[1], tgt[1], t);
    // Follow pointer gaze: eyes look toward mouse
    if (followPointer && hasPointer) {
      const gazeScale = 0.4;
      const gx = pointerX * gazeScale;
      const gy = pointerY * gazeScale * 0.5;
      const applyGaze = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [x + gx, y + gy]);
      left = applyGaze(left);
      right = applyGaze(right);
    }
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

    // Apply transform via renderer container; transform-origin comes from the CSS class
    const svg = container.querySelector<SVGElement>('.claudian-plus-blob__svg');
    if (svg) {
      const sx = scaleSpring.x;
      const sy = squashSpring.x;
      const tx = txSpring.x;
      const ty = tySpring.x;
      const rot = rotSpring.x + (state === 'celebrate' ? Math.sin(now * 0.005) * 8 : 0);
      svg.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`;
    }

    // Overlay handling via class or opacity
    const overlay = container.querySelector<SVGElement>('.claudian-plus-blob__overlay');
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
      if (pointerHandler) {
        window.removeEventListener('pointermove', pointerHandler);
        if (leaveHandler) {
          window.removeEventListener('pointerleave', leaveHandler);
          (getActiveDocument() ?? document).removeEventListener('pointerleave', leaveHandler);
        }
      }
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
