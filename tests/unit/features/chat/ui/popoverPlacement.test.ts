import { computePopoverShift } from '@/features/chat/ui/popoverPlacement';

describe('computePopoverShift', () => {
  const host = { left: 100, right: 500 };

  it('leaves a popover that already fits alone', () => {
    expect(computePopoverShift({ left: 150, right: 450 }, host)).toBe(0);
  });

  it('pushes a popover that overflows the left edge', () => {
    expect(computePopoverShift({ left: 20, right: 320 }, host)).toBe(88);
  });

  it('pulls back a popover that overflows the right edge', () => {
    expect(computePopoverShift({ left: 380, right: 680 }, host)).toBe(-188);
  });

  it('pins an oversized popover to the left margin', () => {
    expect(computePopoverShift({ left: 300, right: 900 }, host)).toBe(-192);
  });

  it('ignores an unmeasured host', () => {
    expect(computePopoverShift({ left: 0, right: 300 }, { left: 0, right: 0 })).toBe(0);
  });

  it('honours a custom margin', () => {
    expect(computePopoverShift({ left: 100, right: 400 }, host, 0)).toBe(0);
    expect(computePopoverShift({ left: 100, right: 400 }, host, 20)).toBe(20);
  });
});
