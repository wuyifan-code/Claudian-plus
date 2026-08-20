import type { EyeShape } from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function lerpPoly(a: [number, number][], b: [number, number][], t: number): [number, number][] {
  const tt = clamp(t, 0, 1);
  if (a.length !== b.length) {
    // If vertex counts differ, truncate to shorter length (upstream data is uniform for our 6 states but guard)
    const len = Math.min(a.length, b.length);
    return Array.from({ length: len }, (_, i) => {
      const ax = a[i][0];
      const ay = a[i][1];
      const bx = b[i][0];
      const by = b[i][1];
      return [ax + (bx - ax) * tt, ay + (by - ay) * tt] as [number, number];
    });
  }
  return a.map((p, i) => {
    const bx = b[i][0];
    const by = b[i][1];
    return [p[0] + (bx - p[0]) * tt, p[1] + (by - p[1]) * tt] as [number, number];
  });
}

export function lerpEye(a: EyeShape, b: EyeShape, t: number): EyeShape {
  const tt = clamp(t, 0, 1);
  return {
    vertices: lerpPoly(a.vertices, b.vertices, tt),
    lid: a.lid + (b.lid - a.lid) * tt,
  };
}

// Helper for eye pair (left/right) as stored in geometry.ts EYES[group][0 or 1]
export function lerpEyePair(
  aPair: [number, number][][],
  bPair: [number, number][][],
  t: number,
): [number, number][][] {
  return [lerpPoly(aPair[0], bPair[0], t), lerpPoly(aPair[1], bPair[1], t)];
}
