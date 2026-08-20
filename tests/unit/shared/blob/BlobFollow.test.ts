import { mapToSmallCircle, calcSquash, mapPointer } from '@/shared/blob/BlobFollow';

describe('BlobFollow', () => {
  it('clamps to small circle radius 6', () => {
    const p = mapToSmallCircle(10, 0, 6);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(6, 5);
    expect(p.x).toBeCloseTo(6, 5);
  });

  it('keeps inside point unchanged', () => {
    const p = mapToSmallCircle(3, 4, 6);
    expect(p.x).toBeCloseTo(3, 5);
    expect(p.y).toBeCloseTo(4, 5);
  });

  it('calcSquash 0.03-0.05 range', () => {
    expect(calcSquash(0)).toBeCloseTo(0.03, 5);
    expect(calcSquash(6)).toBeGreaterThan(0.03);
    expect(calcSquash(6)).toBeLessThan(0.06);
  });

  it('mapPointer ellipse mapping', () => {
    const rect = { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 } as DOMRect;
    const pt = { x: 200, y: 150 } as { x: number; y: number };
    const mapped = mapPointer(rect, pt);
    // Center should map near 0,0
    expect(Math.abs(mapped.x)).toBeLessThan(1);
    expect(Math.abs(mapped.y)).toBeLessThan(1);
  });
});
