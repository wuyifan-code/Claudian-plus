/**
 * Manual requestAnimationFrame queue for widget tests.
 *
 * A block coalesces its store-driven re-renders into one frame, so a test that
 * asserts on the DOM after an interaction must decide where that frame
 * boundary falls. Installing the queue replaces the global rAF pair; `flush()`
 * runs every callback that is waiting for the next frame, in registration
 * order, synchronously.
 */

type FrameCallback = (time: number) => void;

export interface ManualFrames {
  /** Callbacks waiting for the next frame. */
  pending(): number;
  /** Runs every pending callback once. */
  flush(): void;
  /** Restores the environment's own requestAnimationFrame pair. */
  restore(): void;
}

interface FrameHost {
  requestAnimationFrame?: (callback: FrameCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

let active: ManualFrames | null = null;

export function installManualFrames(): ManualFrames {
  const host = globalThis as unknown as FrameHost;
  const previousRequest = host.requestAnimationFrame;
  const previousCancel = host.cancelAnimationFrame;
  const queue = new Map<number, FrameCallback>();
  let handle = 0;

  const frames: ManualFrames = {
    pending(): number {
      return queue.size;
    },
    flush(): void {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(0);
    },
    restore(): void {
      queue.clear();
      host.requestAnimationFrame = previousRequest;
      host.cancelAnimationFrame = previousCancel;
      if (active === frames) active = null;
    },
  };

  host.requestAnimationFrame = (callback: FrameCallback): number => {
    handle += 1;
    queue.set(handle, callback);
    return handle;
  };
  host.cancelAnimationFrame = (id: number): void => {
    queue.delete(id);
  };
  active = frames;
  return frames;
}

/** Runs the render a write scheduled; a no-op when nothing is pending. */
export function flushFrame(): void {
  active?.flush();
}

/** Frame callbacks still waiting; asserts a queue was installed. */
export function pendingFrames(): number {
  if (active === null) throw new Error('installManualFrames() was not called');
  return active.pending();
}
