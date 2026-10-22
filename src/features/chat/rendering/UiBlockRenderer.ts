/**
 * Renders a declarative UI program into an existing element.
 *
 * The streaming renderer empties and rebuilds a text block on every frame, so
 * this module is written to be called repeatedly with the same source: widget
 * state lives in `UiStateStore` (keyed by block), never in the DOM, and a
 * program that cannot be parsed leaves the previous render in place instead of
 * blanking the answer.
 */

import { buildElement, type RenderContext } from './ui/components';
import { createScope, evaluate, type ResolvedAction, type ResolvedElement } from './ui/evaluate';
import { getRootStatement, parseUiProgram } from './ui/parser';
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

interface BlockState {
  unsubscribe: () => void;
}

const blockStates = new WeakMap<HTMLElement, BlockState>();

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
  const program = parseUiProgram(source);
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

  container.empty();
  container.appendChild(node);
  return true;
}

/**
 * Renders (or re-renders) a UI program into `container`.
 * Returns false when nothing renderable was produced and the previous content
 * was therefore left untouched.
 */
export function renderUiBlock(container: HTMLElement, source: string, options: UiBlockOptions): boolean {
  if (source.trim().length === 0) return false;

  disposeUiBlock(container);

  const store = options.store ?? uiStateStore;
  const rendered = renderOnce(container, source, options, store);
  const unsubscribe = store.subscribe(() => {
    renderOnce(container, source, options, store);
  });
  blockStates.set(container, { unsubscribe });
  return rendered;
}

/** Releases the store subscription for a block that is leaving the DOM. */
export function disposeUiBlock(container: HTMLElement): void {
  const state = blockStates.get(container);
  if (state === undefined) return;
  state.unsubscribe();
  blockStates.delete(container);
}
