/**
 * Renders a declarative UI program into an existing element.
 *
 * The streaming renderer empties and rebuilds a text block on every frame, so
 * this module is written to be called repeatedly with the same source and a
 * stable `blockKey`:
 *  - widget state lives in `UiStateStore`, never in the DOM;
 *  - the store subscription is owned per `blockKey`, not per element, so a
 *    rebuilt element does not leak a listener;
 *  - a program that cannot be parsed leaves the previous render in place
 *    instead of blanking the answer;
 *  - a re-render patches the mounted tree in place (see `ui/reconcile`), so
 *    nodes that did not change keep their identity and their CSS transitions;
 *  - store writes are coalesced into one frame per block, so a burst of writes
 *    costs one parse/evaluate/build.
 */

import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { type BuildContext, buildElement, renderValue } from './ui/components';
import { createScope, evaluate, type ResolvedAction, type ResolvedElement } from './ui/evaluate';
import { getRootStatement, parseUiProgramCached } from './ui/parser';
import {
  adoptUiElement,
  annotateUiTree,
  canAdopt,
  captureScrollOffsets,
  markUiInteractive,
  restoreScrollOffsets,
} from './ui/reconcile';
import { type UiStateStore,uiStateStore } from './ui/stateStore';
import type { UiRenderHost } from './ui/widgets/context';

export interface UiBlockCallbacks {
  /** User asked the UI to continue the conversation (`@ToAssistant`). */
  onContinueConversation?(prompt: string, context: unknown): void;
  onOpenUrl?(url: string): void;
  onCopy?(text: string): void;
  /** `@OpenNote` / `NoteLink`: open a vault note by link text. */
  onOpenNote?(linktext: string): void;
  /** `@InsertToNote`: confirm, then insert model-authored markdown into a note. */
  onInsertToNote?(markdown: string): void;
}

export interface UiBlockOptions {
  /** Stable per-widget key, e.g. `messageId:fenceIndex`. */
  blockKey: string;
  /** Conversation that owns the widget state for persistence; unowned blocks claim as `live`. */
  ownerId?: string;
  callbacks?: UiBlockCallbacks;
  /** Optional host services (markdown, notes, vault resources). */
  host?: UiRenderHost;
  /** Legacy scopes to move into `blockKey` before rendering (streaming → settled). */
  migrateFromKeys?: readonly string[];
  /** True while the assistant text is still streaming. */
  streaming?: boolean;
  store?: UiStateStore;
}

/**
 * Stable FNV-1a fingerprint of the full message text. The same transcript
 * content yields the same key on reload and on every provider's history
 * replay, which message ids cannot guarantee.
 */
export function hashUiBlockSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}${source.length.toString(36)}`;
}

/** Reload-safe block key for a settled message: content fingerprint + fence index. */
export function uiContentBlockKey(
  ownerId: string | undefined,
  contentHash: string,
  fenceIndex: number,
): string {
  return `${ownerId ?? 'live'}:c${contentHash}:${String(fenceIndex)}`;
}

interface BlockEntry {
  blockKey: string;
  element: HTMLElement;
  source: string;
  options: UiBlockOptions;
  store: UiStateStore;
  /** Pending coalesced render; `null` when none is scheduled. */
  frame: number | null;
  unsubscribe: () => void;
}

const blocks = new Map<string, BlockEntry>();

const ANIMATED_BLOCK_LIMIT = 512;

/**
 * Blocks that already played their entrance animation in this session, kept as
 * an LRU so a long session cannot grow the set without limit.
 */
const animatedBlocks = new Map<string, true>();

function hasAnimated(blockKey: string): boolean {
  if (!animatedBlocks.has(blockKey)) return false;
  animatedBlocks.delete(blockKey);
  animatedBlocks.set(blockKey, true);
  return true;
}

function markAnimated(blockKey: string): void {
  animatedBlocks.set(blockKey, true);
  while (animatedBlocks.size > ANIMATED_BLOCK_LIMIT) {
    const oldest = animatedBlocks.keys().next();
    if (oldest.done === true) return;
    animatedBlocks.delete(oldest.value);
  }
}

/**
 * Per-block frame coalescing: a store write schedules at most one render, and
 * the render runs at the frame boundary.
 */
function requestFrame(callback: () => void): number {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(() => callback());
  }
  return window.setTimeout(callback, 0);
}

function cancelFrame(handle: number): void {
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle);
    return;
  }
  window.clearTimeout(handle);
}

/**
 * Per-container render state. The mounted root and the toolbar outlive a
 * render, so the next render patches the tree instead of rebuilding it and the
 * toolbar keeps one set of buttons.
 */
interface ContainerSlot {
  root: HTMLElement | null;
  toolbar: HTMLElement | null;
  /** Latest render inputs; the toolbar is built once and reads them through this. */
  inputs: { source: string; options: UiBlockOptions; store: UiStateStore } | null;
}

const slots = new WeakMap<HTMLElement, ContainerSlot>();

function slotOf(container: HTMLElement): ContainerSlot {
  const existing = slots.get(container);
  if (existing !== undefined) return existing;
  const created: ContainerSlot = { root: null, toolbar: null, inputs: null };
  slots.set(container, created);
  return created;
}

function appendStreamingSkeleton(node: HTMLElement): void {
  const skeleton = createDiv({ cls: 'claudian-plus-ui-skeleton' });
  skeleton.createDiv({ cls: 'claudian-plus-ui-skeleton-bar' });
  skeleton.createDiv({ cls: 'claudian-plus-ui-skeleton-bar is-short' });
  node.appendChild(skeleton);
}

/** Static, full-width copy of a block for reading long interfaces. */
function openExpandedPreview(container: HTMLElement, node: HTMLElement): void {
  const doc = container.ownerDocument;
  const overlay = createDiv({ cls: 'claudian-plus-ui-expanded-overlay' });
  const panel = createDiv({ cls: 'claudian-plus-ui-expanded-panel' });
  const close = createEl('button', { cls: 'claudian-plus-ui-expanded-close' });
  close.setAttribute('type', 'button');
  close.setAttribute('aria-label', t('uiBlock.close'));
  close.setAttribute('title', t('uiBlock.close'));
  setIcon(close, 'x');

  const clone = node.cloneNode(true) as HTMLElement;
  clone.classList.remove('is-entering');
  panel.appendChild(close);
  panel.appendChild(clone);
  overlay.appendChild(panel);
  doc.body.appendChild(overlay);

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeOverlay();
  }
  const closeOverlay = (): void => {
    doc.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  close.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeOverlay();
  });
  doc.addEventListener('keydown', onKeyDown);
}

function createBlockToolbar(container: HTMLElement, slot: ContainerSlot): HTMLElement {
  const toolbar = createDiv({ cls: 'claudian-plus-ui-toolbar' });

  const addButton = (icon: string, label: string, onClick: () => void): void => {
    const button = createEl('button', { cls: 'claudian-plus-ui-toolbar-button' });
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    setIcon(button, icon);
    button.addEventListener('click', onClick);
    toolbar.appendChild(button);
  };

  addButton('copy', t('uiBlock.copy'), () => {
    const inputs = slot.inputs;
    if (inputs === null) return;
    if (inputs.options.callbacks?.onCopy !== undefined) inputs.options.callbacks.onCopy(inputs.source);
    else void navigator.clipboard?.writeText(inputs.source);
  });
  addButton('rotate-ccw', t('uiBlock.reset'), () => {
    const inputs = slot.inputs;
    if (inputs === null) return;
    inputs.store.clearScope(inputs.options.blockKey);
    inputs.store.claim(inputs.options.blockKey, inputs.options.ownerId ?? 'live');
  });
  addButton('maximize-2', t('uiBlock.expand'), () => {
    if (slot.root === null) return;
    openExpandedPreview(container, slot.root);
  });
  return toolbar;
}

const SAFE_URL = /^https?:\/\//i;

/**
 * Stable per-widget key, unique across conversations: history replay ids are
 * per-session indexes (e.g. Codex `codex-msg-0`), so the owning conversation
 * must be part of the key or two sessions would share widget state.
 */
export function uiBlockKey(
  ownerId: string | undefined,
  messageId: string | undefined,
  fenceIndex: number,
): string {
  return `${ownerId ?? 'live'}:${messageId ?? 'live'}:${String(fenceIndex)}`;
}

function runHostAction(action: ResolvedAction, callbacks: UiBlockCallbacks | undefined): void {
  if (callbacks === undefined) return;

  switch (action.name) {
    case '@ToAssistant': {
      const prompt = typeof action.values[0] === 'string' ? action.values[0] : '';
      if (prompt.length === 0) return;
      callbacks.onContinueConversation?.(prompt, action.values[1]);
      return;
    }
    case '@OpenUrl': {
      const url = action.values[0];
      if (typeof url !== 'string' || !SAFE_URL.test(url)) return;
      callbacks.onOpenUrl?.(url);
      return;
    }
    case '@Copy': {
      const text = action.values[0];
      if (typeof text !== 'string') return;
      callbacks.onCopy?.(text);
      return;
    }
    case '@OpenNote': {
      const linktext = action.values[0];
      if (typeof linktext !== 'string' || linktext.trim().length === 0) return;
      callbacks.onOpenNote?.(linktext);
      return;
    }
    case '@InsertToNote': {
      const markdown = action.values[0];
      if (typeof markdown !== 'string' || markdown.trim().length === 0) return;
      callbacks.onInsertToNote?.(markdown);
      return;
    }
    default:
      return;
  }
}

function isElementValue(value: unknown): value is ResolvedElement {
  return value !== null
    && typeof value === 'object'
    && (value as { type?: unknown }).type === 'element';
}

/** Focus snapshot for a bound widget control, carried across re-renders. */
export interface InputFocus {
  binding: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

/** Input types whose selectionStart/End read safely on every engine. */
const TEXT_SELECTION_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password', 'email']);

/**
 * Reads the focused bound control inside `container`; call before the old DOM
 * is emptied. Selection is only read for text-like inputs: other types return
 * null on modern engines and throw on legacy ones.
 */
export function captureUiFocus(container: HTMLElement): InputFocus | null {
  const active = document.activeElement;
  const isTextArea = active instanceof HTMLTextAreaElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement || isTextArea)) return null;
  const binding = active.dataset.uiBinding;
  if (binding === undefined || binding.length === 0) return null;
  if (!container.contains(active)) return null;
  // Selection is only read for text-like controls: other input types return
  // null on modern engines and throw on legacy ones.
  const selectionTarget = isTextArea
    ? active
    : active instanceof HTMLInputElement && TEXT_SELECTION_INPUT_TYPES.has(active.type)
      ? active
      : null;
  return {
    binding,
    selectionStart: selectionTarget?.selectionStart ?? null,
    selectionEnd: selectionTarget?.selectionEnd ?? null,
  };
}

function findBoundControl(
  container: HTMLElement,
  binding: string,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  // Binding names come from the model; escape before selector interpolation and
  // fall back to a scan where CSS.escape is unavailable (jsdom).
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    const escaped = CSS.escape(binding);
    return container.querySelector(
      `input[data-ui-binding="${escaped}"], select[data-ui-binding="${escaped}"], textarea[data-ui-binding="${escaped}"`,
    );
  }
  const candidates = container.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('input[data-ui-binding], select[data-ui-binding], textarea[data-ui-binding]');
  for (const candidate of Array.from(candidates)) {
    if (candidate.dataset.uiBinding === binding) return candidate;
  }
  return null;
}

/** Refocuses the rebuilt twin of a captured control so typing survives re-renders. */
export function restoreUiFocus(container: HTMLElement, focus: InputFocus | null): void {
  if (focus === null) return;
  const next = findBoundControl(container, focus.binding);
  if (next === null) return;
  next.focus();
  if ((next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)
    && focus.selectionStart !== null
    && focus.selectionEnd !== null) {
    next.setSelectionRange(focus.selectionStart, focus.selectionEnd);
  }
}

/** Registers a widget listener and marks the node so it is never adopted. */
function bindListener<K extends keyof HTMLElementEventMap>(
  element: HTMLElement,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
): void {
  element.addEventListener(type, handler);
  markUiInteractive(element);
}

/** Mounts `next` as the block root, adopting the previous root when it still fits. */
function mountRoot(container: HTMLElement, slot: ContainerSlot, next: HTMLElement): void {
  const previous = slot.root;
  if (previous !== null && previous.parentElement === container && canAdopt(previous, next)) {
    adoptUiElement(previous, next);
    if (container.firstChild !== previous) container.insertBefore(previous, container.firstChild);
    return;
  }
  previous?.remove();
  slot.root = next;
  container.insertBefore(next, container.firstChild);
}

function renderOnce(
  container: HTMLElement,
  slot: ContainerSlot,
  source: string,
  options: UiBlockOptions,
  store: UiStateStore,
): boolean {
  const program = parseUiProgramCached(source);
  const root = getRootStatement(program);
  if (root === undefined || root.expr === null) return false;

  const scope = createScope(program, (name) => store.get(options.blockKey, name));
  const rootValue = evaluate(root.expr, scope);
  if (!isElementValue(rootValue)) return false;

  const counters = new Map<string, number>();
  const context: BuildContext = {
    scope,
    setState: (name, value) => store.set(options.blockKey, name, value),
    resetState: (names) => {
      for (const name of names) store.set(options.blockKey, name, undefined);
    },
    runAction: (action) => runHostAction(action, options.callbacks),
    // State writes already notify the store subscription below; a second
    // render pass here would rebuild the block twice per interaction.
    rerender: () => undefined,
    // Local widget state (active tab, open accordion) is keyed by render order,
    // so it survives streaming rebuilds without the program declaring a `$var`.
    autoKey: (kind) => {
      const index = counters.get(kind) ?? 0;
      counters.set(kind, index + 1);
      return `${kind}#${String(index)}`;
    },
    host: options.host,
    render: (value) => renderValue(value, context),
    on: bindListener,
  };

  const node = buildElement(rootValue, context);
  if (node === null) return false;

  // Keys and interactivity are derived from the finished tree in one pass, so a
  // widget that binds a listener to itself before it is attached is still
  // marked together with its ancestors.
  annotateUiTree(node);

  if (options.streaming === true) {
    // Early frames can have a root but no resolved children yet.
    if (node.textContent.trim().length === 0) appendStreamingSkeleton(node);
  } else if (!hasAnimated(options.blockKey)) {
    node.classList.add('is-entering');
    markAnimated(options.blockKey);
  }

  // The rebuild of a listener-holding control would otherwise destroy the input
  // the user is typing in; carry focus and caret across by binding name.
  const focus = captureUiFocus(container);
  const scroll = captureScrollOffsets(container);

  slot.inputs = { source, options, store };
  mountRoot(container, slot, node);
  const toolbar = slot.toolbar ?? createBlockToolbar(container, slot);
  slot.toolbar = toolbar;
  if (container.lastElementChild !== toolbar) container.appendChild(toolbar);

  restoreScrollOffsets(container, scroll);
  restoreUiFocus(container, focus);
  return true;
}

function releaseEntry(entry: BlockEntry, key: string): void {
  if (entry.frame !== null) {
    cancelFrame(entry.frame);
    entry.frame = null;
  }
  entry.unsubscribe();
  if (blocks.get(key) === entry) blocks.delete(key);
}

/** The single place that decides when a written block rebuilds. */
function scheduleRerender(entry: BlockEntry): void {
  if (entry.frame !== null) return;
  entry.frame = requestFrame(() => {
    entry.frame = null;
    if (blocks.get(entry.blockKey) !== entry) return;
    // The message window may have evicted this node; do not write to it.
    if (!entry.element.isConnected) {
      releaseEntry(entry, entry.blockKey);
      return;
    }
    renderOnce(entry.element, slotOf(entry.element), entry.source, entry.options, entry.store);
  });
}

/**
 * Renders (or re-renders) a UI program into `container`.
 * Returns false when nothing renderable was produced, so the caller can fall
 * back to showing the program as a plain code block.
 */
export function renderUiBlock(container: HTMLElement, source: string, options: UiBlockOptions): boolean {
  if (source.trim().length === 0) return false;

  const store = options.store ?? uiStateStore;
  for (const from of options.migrateFromKeys ?? []) {
    store.adoptScope(from, options.blockKey);
    const previous = blocks.get(from);
    if (previous !== undefined) releaseEntry(previous, from);
  }
  store.claim(options.blockKey, options.ownerId ?? 'live');
  const previous = blocks.get(options.blockKey);
  if (previous !== undefined) releaseEntry(previous, options.blockKey);

  const rendered = renderOnce(container, slotOf(container), source, options, store);

  const entry: BlockEntry = {
    blockKey: options.blockKey,
    element: container,
    source,
    options,
    store,
    frame: null,
    unsubscribe: () => undefined,
  };
  entry.unsubscribe = store.subscribe((scope) => {
    if (scope !== entry.blockKey) return;
    if (blocks.get(entry.blockKey) !== entry) return;
    if (!entry.element.isConnected) {
      releaseEntry(entry, entry.blockKey);
      return;
    }
    scheduleRerender(entry);
  });
  blocks.set(entry.blockKey, entry);

  return rendered;
}

/**
 * Runs a block's pending coalesced render immediately. Hosts that read or
 * measure the DOM in the same task as a state write call this instead of
 * relying on frame timing.
 */
export function flushUiRender(element: HTMLElement): void {
  for (const entry of [...blocks.values()]) {
    if (entry.element !== element || entry.frame === null) continue;
    cancelFrame(entry.frame);
    entry.frame = null;
    if (!entry.element.isConnected) {
      releaseEntry(entry, entry.blockKey);
      continue;
    }
    renderOnce(entry.element, slotOf(entry.element), entry.source, entry.options, entry.store);
  }
}

/** Releases the store subscription bound to an element that left the DOM. */
export function disposeUiBlock(element: HTMLElement): void {
  for (const [key, entry] of [...blocks]) {
    if (entry.element === element) releaseEntry(entry, key);
  }
}

/** Releases every UI block found under `root` (message eviction / removal). */
export function disposeUiBlocksUnder(root: HTMLElement): void {
  const owned = new Set<HTMLElement>();
  for (const entry of blocks.values()) {
    if (entry.element === root || root.contains(entry.element)) owned.add(entry.element);
  }
  for (const element of owned) disposeUiBlock(element);
}

/** Drops subscriptions for elements the document no longer holds. */
export function pruneDetachedUiBlocks(): void {
  for (const [key, entry] of [...blocks]) {
    if (!entry.element.isConnected) releaseEntry(entry, key);
  }
}

/** Test hook: number of live widget subscriptions. */
export function uiBlockSubscriptionCount(): number {
  return blocks.size;
}
