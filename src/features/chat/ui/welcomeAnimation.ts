/**
 * Common surface for the welcome tab animation implementations.
 * The full Three.js cube and the lightweight 2D canvas animation both
 * implement this contract so the chat renderer can route between them
 * without depending on either implementation.
 */
export interface WelcomeAnimation {
  /** Stops the animation loop while preserving the last rendered frame. */
  pause(): void;
  /** Resumes the animation loop. */
  resume(): void;
  /** Releases animation resources and removes the DOM wrapper. */
  destroy(): void;
}

export type WelcomeAnimationMode = 'full' | 'lite' | 'off';
