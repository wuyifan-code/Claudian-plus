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
 *    instead of blanking the answer.
 */

import { buildElement, type RenderContext } from './ui/components';
import { createScope, evaluate, type ResolvedAction, type ResolvedElement } from './ui/evaluate';
import { getRootStatement, parseUiProgramCached } from './ui/parser';
import { type UiStateStore,uiStateStore } from './ui/stateStore';

export interface UiBlockCallbacks {
  /** User asked the UI to continue the conversation (`@ToAssistant`). */
  onContinueConversation?(prompt: string, context: unknown): void;
  onOpenUrl?(url: string): void;
  onCopy?(text: string): void;
}

export interface UiBlockOptions {
  /** Stable per-widget key, e.g. `messageId:fenceIndex`. */
  blockKey: string;
  /** Conversation that owns the widget state for persistence; unowned blocks claim as `live`. */
  ownerId?: string;
  callbacks?: UiBlockCallbacks;
  store?: UiStateStore;
}

interface BlockEntry {
  blockKey: string;
  element: HTMLElement;
  source: string;
  options: UiBlockOptions;
  unsubscribe: () => void;
}

const blocks = new Map<string, BlockEntry>();

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
  if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement)) return null;
  const binding = active.dataset.uiBinding;
  if (binding === undefined || binding.length === 0) return null;
  if (!container.contains(active)) return null;
  const supportsSelection = active instanceof HTMLInputElement
    && TEXT_SELECTION_INPUT_TYPES.has(active.type);
  return {
    binding,
    selectionStart: supportsSelection ? active.selectionStart : null,
    selectionEnd: supportsSelection ? active.selectionEnd : null,
  };
}

function findBoundControl(
  container: HTMLElement,
  binding: string,
): HTMLInputElement | HTMLSelectElement | null {
  // Binding names come from the model; escape before selector interpolation and
  // fall back to a scan where CSS.escape is unavailable (jsdom).
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    const escaped = CSS.escape(binding);
    return container.querySelector(
      `input[data-ui-binding="${escaped}"], select[data-ui-binding="${escaped}"]`,
    );
  }
  const candidates = container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    'input[data-ui-binding], select[data-ui-binding]',
  );
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
  if (next instanceof HTMLInputElement
    && focus.selectionStart !== null
    && focus.selectionEnd !== null) {
    next.setSelectionRange(focus.selectionStart, focus.selectionEnd);
  }
}

function renderOnce(
  container: HTMLElement,
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

  const context: RenderContext = {
    scope,
    setState: (name, value) => store.set(options.blockKey, name, value),
    resetState: (names) => {
      for (const name of names) store.set(options.blockKey, name, undefined);
    },
    runAction: (action) => runHostAction(action, options.callbacks),
    // State writes already notify the store subscription below; a second
    // render pass here would rebuild the block twice per interaction.
    rerender: () => undefined,
  };

  const node = buildElement(rootValue, context);
  if (node === null) return false;

  // The full rebuild would otherwise destroy the input the user is typing in
  // on every keystroke; carry focus and caret across by binding name.
  const focus = captureUiFocus(container);
  container.replaceChildren();
  container.appendChild(node);
  restoreUiFocus(container, focus);
  return true;
}

/**
 * Renders (or re-renders) a UI program into `container`.
 * Returns false when nothing renderable was produced, so the caller can fall
 * back to showing the program as a plain code block.
 */
export function renderUiBlock(container: HTMLElement, source: string, options: UiBlockOptions): boolean {
  if (source.trim().length === 0) return false;

  const store = options.store ?? uiStateStore;
  store.claim(options.blockKey, options.ownerId ?? 'live');
  const previous = blocks.get(options.blockKey);
  if (previous !== undefined) {
    previous.unsubscribe();
    blocks.delete(options.blockKey);
  }

  const rendered = renderOnce(container, source, options, store);

  const entry: BlockEntry = {
    blockKey: options.blockKey,
    element: container,
    source,
    options,
    unsubscribe: () => undefined,
  };
  entry.unsubscribe = store.subscribe(() => {
    if (blocks.get(entry.blockKey) !== entry) return;
    // The message window may have evicted this node; stop listening.
    if (!entry.element.isConnected) {
      entry.unsubscribe();
      blocks.delete(entry.blockKey);
      return;
    }
    renderOnce(entry.element, entry.source, entry.options, store);
  });
  blocks.set(entry.blockKey, entry);

  return rendered;
}

/** Releases the store subscription bound to an element that left the DOM. */
export function disposeUiBlock(element: HTMLElement): void {
  for (const [key, entry] of [...blocks]) {
    if (entry.element === element) {
      entry.unsubscribe();
      blocks.delete(key);
    }
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
    if (!entry.element.isConnected) {
      entry.unsubscribe();
      blocks.delete(key);
    }
  }
}

/** Test hook: number of live widget subscriptions. */
export function uiBlockSubscriptionCount(): number {
  return blocks.size;
}
