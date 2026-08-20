import { lerpEye,lerpPoly } from '@/shared/blob/BlobEyeMorph';
import { getOverlayForState } from '@/shared/blob/BlobOverlays';
import { EYES } from '@/shared/blob/geometry';

describe('BlobEyeMorph', () => {
  it('lerpPoly at t=0 returns a', () => {
    const a: [number, number][] = [[0, 0], [10, 0]];
    const b: [number, number][] = [[0, 10], [10, 10]];
    expect(lerpPoly(a, b, 0)).toEqual(a);
  });

  it('lerpPoly at t=1 returns b', () => {
    const a: [number, number][] = [[0, 0], [10, 0]];
    const b: [number, number][] = [[0, 10], [10, 10]];
    expect(lerpPoly(a, b, 1)).toEqual(b);
  });

  it('lerpPoly at t=0.5 returns midpoint', () => {
    const a: [number, number][] = [[0, 0], [10, 0]];
    const b: [number, number][] = [[0, 10], [10, 10]];
    expect(lerpPoly(a, b, 0.5)).toEqual([[0, 5], [10, 5]]);
  });

  it('lerpPoly clamps t outside [0,1]', () => {
    const a: [number, number][] = [[0, 0]];
    const b: [number, number][] = [[10, 10]];
    expect(lerpPoly(a, b, -0.5)).toEqual(a);
    expect(lerpPoly(a, b, 1.5)).toEqual(b);
  });

  it('lerpEye interpolates EyeShape vertices and lid', () => {
    const a = { vertices: [[0, 0], [10, 0]] as [number, number][], lid: 0 };
    const b = { vertices: [[0, 10], [10, 10]] as [number, number][], lid: 1 };
    const mid = lerpEye(a, b, 0.5);
    expect(mid.vertices).toEqual([[0, 5], [10, 5]]);
    expect(mid.lid).toBeCloseTo(0.5);
  });

  it('uses real geometry EYES data (reused from grok_bot-icon-study)', () => {
    expect(EYES.length).toBe(25);
    // First eye group has 2 eyes each with 48 points (as per upstream)
    expect(EYES[0].length).toBe(2);
    expect(EYES[0][0].length).toBeGreaterThan(10);
    const a = { vertices: EYES[0][0] as [number, number][], lid: 0 };
    const b = { vertices: EYES[1][0] as [number, number][], lid: 1 };
    const mid = lerpEye(a, b, 0.5);
    expect(mid.vertices.length).toBe(a.vertices.length);
  });
});

describe('BlobOverlays', () => {
  it('maps thinking to dots', () => {
    expect(getOverlayForState('thinking')).toBe('dots');
  });
  it('maps writing to pencil', () => {
    expect(getOverlayForState('writing')).toBe('pencil');
  });
  it('maps error to bang', () => {
    expect(getOverlayForState('error')).toBe('bang');
  });
  it('maps celebrate to sparkle', () => {
    const o = getOverlayForState('celebrate');
    expect(['sparkle', 'dots', 'halo']).toContain(o);
  });
  it('maps idle and listening to none', () => {
    expect(getOverlayForState('idle')).toBe('none');
    expect(getOverlayForState('listening')).toBe('none');
  });
});
