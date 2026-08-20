import type { SpringPreset } from './types';

export interface Spring {
  x: number;
  v: number;
  t: number;
  freq: number;
  damp: number;
  mass: number;
}

export const DT = 1 / 120;

export function createSpring(freq: number, damp: number, mass: number, initial: number): Spring {
  return { x: initial, v: 0, t: initial, freq, damp, mass };
}

export function createSpringFromPreset(preset: SpringPreset, initial: number): Spring {
  return createSpring(preset.stiffness, preset.damping, preset.mass, initial);
}

export function stepSpring(s: Spring, freq: number, damp: number, dt: number): void {
  // Allow calling as stepSpring(s, freq, damp, dt) or stepSpring(s, preset) — detect via args
  // For our API we use explicit freq/damp; s stores its own but we respect passed values
  s.v += (-2 * damp * freq * s.v - freq * freq * (s.x - s.t)) * dt;
  s.x += s.v * dt;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
    s.x = s.t;
    s.v = 0;
  }
}

export function springSteps(dt: number): number {
  return Math.max(1, Math.ceil(dt / DT));
}

export function isSettled(s: Spring, epsilon = 0.001): boolean {
  return Math.abs(s.x - s.t) < epsilon && Math.abs(s.v) < epsilon;
}

// Helper to step with substeps for stability (as in GrokCharacter._tick)
export function stepSpringWithSubsteps(s: Spring, dt: number): void {
  const n = springSteps(dt);
  const step = dt / n;
  for (let i = 0; i < n; i++) {
    stepSpring(s, s.freq, s.damp, step);
  }
}
