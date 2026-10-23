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

  container.replaceChildren();
  container.appendChild(node);
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
