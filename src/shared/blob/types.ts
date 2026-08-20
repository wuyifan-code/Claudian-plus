export type BlobState = 'idle' | 'listening' | 'thinking' | 'writing' | 'error' | 'celebrate';

export type BlobEvent = 'inputFocus' | 'inputBlur' | 'streamStart' | 'streamEnd' | 'error' | 'success' | 'reset';

export interface SpringPreset {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface EyeShape {
  vertices: [number, number][];
  lid: number;
}

export type OverlayKind = 'none' | 'dots' | 'pencil' | 'bang' | 'sparkle' | 'halo';

export interface BlobStateConfig {
  eye: EyeShape;
  overlay: OverlayKind;
  spring: SpringPreset;
  durationMs?: number;
}

export interface BlobFrame {
  state: BlobState;
  eye: EyeShape;
  overlay: OverlayKind;
  scale: number;
  rotation: number;
}
