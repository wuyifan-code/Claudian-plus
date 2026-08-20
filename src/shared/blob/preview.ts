import { createBlobEngine } from './BlobEngine';
import type { BlobState } from './types';

const PREVIEW_STATES: BlobState[] = ['idle', 'listening', 'thinking', 'writing', 'error', 'celebrate'];
const CYCLE_MS = 2000;

let currentCleanup: (() => void) | null = null;

export function mountBlobPreview(): () => void {
  if (currentCleanup) currentCleanup();

  const host = createDiv();
  host.className = 'claudian-plus-blob-preview';
  host.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'z-index:9999',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:8px',
    'padding:12px',
    'background:var(--claudian-plus-surface-primary)',
    'border:1px solid var(--claudian-plus-border)',
    'border-radius:var(--claudian-plus-radius-lg, 12px)',
    'box-shadow:var(--claudian-plus-shadow-md)',
  ].join(';');

  const label = createDiv();
  label.style.cssText = 'font-size:12px;color:var(--claudian-plus-text-muted)';
  label.textContent = 'Blob Preview (6 states cycle)';

  const blobHost = createDiv();
  // Use large size for preview
  const engine = createBlobEngine(blobHost, { size: 'large', initialState: 'idle' });

  const controls = createDiv();
  controls.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;justify-content:center';
  for (const s of PREVIEW_STATES) {
    const btn = createEl('button');
    btn.textContent = s;
    btn.style.cssText = 'padding:2px 6px;font-size:11px;border:1px solid var(--claudian-plus-border);border-radius:4px;background:var(--claudian-plus-surface-secondary);color:var(--claudian-plus-text-normal);cursor:pointer';
    btn.onclick = () => engine.setState(s);
    controls.appendChild(btn);
  }

  const closeBtn = createEl('button');
  closeBtn.textContent = '× Close';
  closeBtn.style.cssText = 'padding:2px 8px;font-size:11px;border:none;background:var(--claudian-plus-surface-hover);color:var(--claudian-plus-text-normal);cursor:pointer;border-radius:4px';
  closeBtn.onclick = () => cleanup();

  host.appendChild(label);
  host.appendChild(blobHost);
  host.appendChild(controls);
  host.appendChild(closeBtn);
  document.body.appendChild(host);

  let idx = 0;
  const interval = window.setInterval(() => {
    idx = (idx + 1) % PREVIEW_STATES.length;
    engine.setState(PREVIEW_STATES[idx]);
    label.textContent = `Blob Preview: ${PREVIEW_STATES[idx]} (${idx + 1}/6)`;
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
