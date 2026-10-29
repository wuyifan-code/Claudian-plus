export interface HorizontalSpan {
  left: number;
  right: number;
}

/**
 * Nudges a popover back inside its host panel. Returns the horizontal offset to
 * apply; a popover wider than the host is pinned to the left margin.
 */
export function computePopoverShift(
  popover: HorizontalSpan,
  host: HorizontalSpan,
  margin = 8,
): number {
  const minLeft = host.left + margin;
  const maxRight = host.right - margin;
  const popoverWidth = popover.right - popover.left;
  const hostWidth = maxRight - minLeft;

  if (hostWidth <= 0) {
    return 0;
  }
  if (popoverWidth > hostWidth) {
    return minLeft - popover.left;
  }
  if (popover.left < minLeft) {
    return minLeft - popover.left;
  }
  if (popover.right > maxRight) {
    return maxRight - popover.right;
  }
  return 0;
}
