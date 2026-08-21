import { createBlobEngine } from './BlobEngine';
import type { BlobState } from './types';

const PREVIEW_STATES: BlobState[] = ['idle', 'listening', 'thinking', 'writing', 'error', 'celebrate'];
const CYCLE_MS = 2000;

let currentCleanup: (() => void) | null = null;

export function mountBlobPreview(): () => void {
  if (currentCleanup) currentCleanup();

  const host = createDiv('claudian-plus-blob-preview');

  const label = createDiv('claudian-plus-blob-preview__label');
  label.textContent = 'Blob preview (6 states cycle)';

  const blobHost = createDiv();
  // Use large size for preview, followPointer toggle
  let followEnabled = true;
  let engine = createBlobEngine(blobHost, { size: 'large', initialState: 'idle', followPointer: followEnabled });

  const controls = createDiv('claudian-plus-blob-preview__controls');
  for (const s of PREVIEW_STATES) {
    const btn = createEl('button', { cls: 'claudian-plus-blob-preview__btn' });
    btn.textContent = s;
    btn.onclick = () => engine.setState(s);
    controls.appendChild(btn);
  }

  const followBtn = createEl('button', { cls: 'claudian-plus-blob-preview__btn' });
  followBtn.textContent = 'Follow: ON';
  followBtn.onclick = () => {
    followEnabled = !followEnabled;
    followBtn.textContent = `Follow: ${followEnabled ? 'ON' : 'OFF'}`;
    // Recreate engine with new flag
    engine.destroy();
    blobHost.empty();
    engine = createBlobEngine(blobHost, { size: 'large', initialState: 'idle', followPointer: followEnabled });
  };

  const closeBtn = createEl('button', { cls: 'claudian-plus-blob-preview__btn claudian-plus-blob-preview__btn--close' });
  closeBtn.textContent = '× close';
  closeBtn.onclick = () => cleanup();

  host.appendChild(label);
  host.appendChild(blobHost);
  host.appendChild(controls);
  host.appendChild(followBtn);
  host.appendChild(closeBtn);
  document.body.appendChild(host);

  let idx = 0;
  const interval = window.setInterval(() => {
    idx = (idx + 1) % PREVIEW_STATES.length;
    engine.setState(PREVIEW_STATES[idx]);
    label.textContent = `Blob preview: ${PREVIEW_STATES[idx]} (${idx + 1}/6)`;
  }, CYCLE_MS);

  function cleanup() {
    window.clearInterval(interval);
    engine.destroy();
    host.remove();
    if (currentCleanup === cleanup) currentCleanup = null;
  }

  currentCleanup = cleanup;
  return cleanup;
}

// Expose for console: window.__CLAUDIAN_BLOB_PREVIEW__ = mountBlobPreview
declare global {
  interface Window {
    __CLAUDIAN_BLOB_PREVIEW__?: typeof mountBlobPreview;
  }
}
if (typeof window !== 'undefined') {
  window.__CLAUDIAN_BLOB_PREVIEW__ = mountBlobPreview;
}
