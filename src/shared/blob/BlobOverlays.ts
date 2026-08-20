import type { BlobState, OverlayKind } from './types';

// Direct mapping from BlobState to overlay kind, derived from grok_bot-icon-study replica/src/fx.js MAP
// thinking -> dots, writing -> pencil, error (alerting) -> bang, celebrate -> sparkle/dots
const OVERLAY_MAP: Record<BlobState, OverlayKind> = {
  idle: 'none',
  listening: 'none',
  thinking: 'dots',
  writing: 'pencil',
  error: 'bang',
  celebrate: 'sparkle',
};

export function getOverlayForState(state: BlobState): OverlayKind {
  return OVERLAY_MAP[state] ?? 'none';
}

export const OVERLAY_KINDS = new Set<OverlayKind>(['none', 'dots', 'pencil', 'bang', 'sparkle', 'halo']);
