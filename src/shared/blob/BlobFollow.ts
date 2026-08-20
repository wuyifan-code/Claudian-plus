export function mapToSmallCircle(dx: number, dy: number, radius = 6): { x: number; y: number } {
  const dist = Math.hypot(dx, dy);
  if (dist <= radius) return { x: dx, y: dy };
  const scale = radius / dist;
  return { x: dx * scale, y: dy * scale };
}

export function calcSquash(dist: number): number {
  // 0 at center, ~0.05 at edge (6px)
  const t = Math.min(dist / 6, 1);
  return 0.03 + 0.02 * t;
}

export function mapPointer(rect: DOMRect, pt: { x: number; y: number }): { x: number; y: number } {
  const JFe = 0.6;
  const ain = 22;
  const iin = 14;
  const oin = 2;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const rx = pt.x - cx;
  const ry = pt.y - cy;
  const o = Math.min(1, Math.sqrt(Math.hypot(rx, ry) / (rect.width * oin)));
  const l = Math.atan2(ry, rx);
  return {
    x: JFe * (ain / iin) * o * Math.cos(l) * rect.width * 0.01,
    y: JFe * o * Math.sin(l) * rect.height * 0.01,
  };
}

// Simplified for small-circle follow: direct dx/dy from center, clamped
export function mapPointerToSmallCircle(rect: DOMRect, pt: { x: number; y: number }, radius = 6): { x: number; y: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = pt.x - cx;
  const dy = pt.y - cy;
  // Normalize to small circle: map full rect to small circle via scale
  const scale = 0.05; // 400px rect -> 20px blob movement range, then clamp to 6
  return mapToSmallCircle(dx * scale, dy * scale, radius);
}
