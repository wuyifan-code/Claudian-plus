import { createSpring, DT,isSettled, springSteps, stepSpring } from '@/shared/blob/BlobSpring';

describe('BlobSpring', () => {
  it('creates spring with initial value', () => {
    const s = createSpring(5, 0.9, 1, 0);
    expect(s.x).toBe(0);
    expect(s.v).toBe(0);
    expect(s.t).toBe(0);
  });

  it('step moves toward target', () => {
    const s = createSpring(5, 0.9, 1, 0);
    s.t = 10;
    stepSpring(s, 5, 0.9, 0.016);
    expect(s.x).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(10);
  });

  it('converges to target with many steps', () => {
    const s = createSpring(10, 0.8, 1, 0);
    s.t = 1;
    for (let i = 0; i < 600; i++) {
      stepSpring(s, 10, 0.8, DT);
    }
    expect(s.x).toBeCloseTo(1, 2);
    expect(isSettled(s)).toBe(true);
  });

  it('isSettled respects epsilon', () => {
    const s = createSpring(5, 1, 1, 0);
    s.x = 0.001;
    s.v = 0.001;
    s.t = 0;
    expect(isSettled(s, 0.01)).toBe(true);
    expect(isSettled(s, 0.0001)).toBe(false);
  });

  it('stability across 60 and 120 fps dt', () => {
    const make = () => {
      const s = createSpring(5, 0.9, 1, 0);
      s.t = 5;
      return s;
    };
    const s60 = make();
    const s120 = make();
    // 1 second at 60fps (60 steps of 16.66ms) vs 120fps (120 steps of 8.33ms)
    for (let i = 0; i < 60; i++) stepSpring(s60, 5, 0.9, 1 / 60);
    for (let i = 0; i < 120; i++) stepSpring(s120, 5, 0.9, 1 / 120);
    expect(s60.x).toBeCloseTo(s120.x, 1);
  });

  it('springSteps computes correct substeps', () => {
    expect(springSteps(1 / 60)).toBeGreaterThanOrEqual(1);
    expect(springSteps(0.1)).toBeGreaterThan(1);
    expect(DT).toBeCloseTo(1 / 120);
  });

  it('handles NaN gracefully', () => {
    const s = createSpring(5, 0.9, 1, 0);
    s.x = NaN;
    s.v = NaN;
    stepSpring(s, 5, 0.9, 0.016);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Number.isFinite(s.v)).toBe(true);
  });
});
