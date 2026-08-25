import { createBlobEngine } from '@/shared/blob/BlobEngine';

import { collapseElement, setupCollapsible } from './collapsible';

export type RenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

export interface ThinkingBlockState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: number | null;
  timerWindow: Window | null;
  isExpanded: boolean;
  blobEngine?: ReturnType<typeof createBlobEngine> | null;
  blobHost?: HTMLElement | null;
}

export function createThinkingBlock(
  parentEl: HTMLElement,
  renderContent: RenderContentFn
): ThinkingBlockState {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-plus-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'claudian-plus-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', 'Execution details - click to expand');

  // Blob animation (small, thinking state)
  const blobHost = header.createDiv({ cls: 'claudian-plus-thinking-blob' });
  const blobEngine = createBlobEngine(blobHost, { size: 'small', initialState: 'thinking' });

  // Label with timer
  const labelEl = header.createSpan({ cls: 'claudian-plus-thinking-label' });
  const startTime = Date.now();
  labelEl.setText('Working 0s...');

  // Start timer interval to update label every second
  const timerWindow = wrapperEl.ownerDocument.defaultView ?? window;
  const timerInterval = timerWindow.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    labelEl.setText(`Working ${elapsed}s...`);
  }, 1000);

  // Collapsible content (collapsed by default)
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-plus-thinking-content' });

  // Create state object first so toggle can reference it
  const state: ThinkingBlockState = {
    wrapperEl,
    contentEl,
    labelEl,
    content: '',
    startTime,
    timerInterval,
    timerWindow,
    isExpanded: false,
    blobEngine,
    blobHost,
  };

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  setupCollapsible(wrapperEl, header, contentEl, state);

  return state;
}

export async function appendThinkingContent(
  state: ThinkingBlockState,
  content: string,
  renderContent: RenderContentFn
) {
  state.content += content;
  await renderContent(state.contentEl, state.content);
}

export function finalizeThinkingBlock(state: ThinkingBlockState): number {
  // Stop the timer
  if (state.timerInterval !== null) {
    (state.timerWindow ?? window).clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.timerWindow = null;

  // Update blob to celebrate then idle
  state.blobEngine?.setState('celebrate');
  window.setTimeout(() => {
    state.blobEngine?.setState('idle');
  }, 1200);

  // Calculate final duration
  const durationSeconds = Math.floor((Date.now() - state.startTime) / 1000);

  // Update label to show final duration (without "...")
  state.labelEl.setText(`Execution details · ${durationSeconds}s`);

  // Collapse when done and sync state
  const header = state.wrapperEl.querySelector('.claudian-plus-thinking-header');
  if (header) {
    collapseElement(state.wrapperEl, header as HTMLElement, state.contentEl, state);
  }

  return durationSeconds;
}

export function cleanupThinkingBlock(state: ThinkingBlockState | null) {
  if (state?.timerInterval !== null && state?.timerInterval !== undefined) {
    (state.timerWindow ?? window).clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  if (state) state.timerWindow = null;
  state?.blobEngine?.destroy();
  if (state?.blobHost) {
    state.blobHost.remove();
    state.blobHost = null;
  }
  if (state) state.blobEngine = null;
}

export interface ThinkingSummaryOptions {
  durationMs?: number;
  durationSeconds?: number;
}

export function buildThinkingSummary(opts: ThinkingSummaryOptions): string {
  if (typeof opts.durationMs === 'number') {
    const s = (opts.durationMs / 1000).toFixed(opts.durationMs % 1000 === 0 ? 0 : 1);
    return `Thought · ${s}s`;
  }
  if (typeof opts.durationSeconds === 'number') {
    return `Thought · ${opts.durationSeconds}s`;
  }
  return 'Thought';
}

export interface StoredThinkingOptions {
  collapsedByDefault?: boolean;
}

export function renderStoredThinkingBlock(
  parentEl: HTMLElement,
  content: string,
  durationSeconds: number | undefined,
  renderContent: RenderContentFn,
  options: StoredThinkingOptions = {}
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-plus-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'claudian-plus-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', 'Execution details - click to expand');

  // Static blob for stored block (idle)
  const blobHost = header.createDiv({ cls: 'claudian-plus-thinking-blob' });
  const blobEngine = createBlobEngine(blobHost, { size: 'small', initialState: 'idle' });
  // Keep idle, no need to animate further; will be cleaned up with wrapper
  void blobEngine;

  // Label with duration
  const labelEl = header.createSpan({ cls: 'claudian-plus-thinking-label' });
  const labelText = durationSeconds !== undefined
    ? `Execution details · ${durationSeconds}s`
    : 'Execution details';
  labelEl.setText(labelText);

  // Collapsible content
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-plus-thinking-content' });
  void renderContent(contentEl, content).catch(() => {
    contentEl.setText(content);
  });

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, header, contentEl, state, {
    initiallyExpanded: options.collapsedByDefault ? false : false,
  });

  return wrapperEl;
}
