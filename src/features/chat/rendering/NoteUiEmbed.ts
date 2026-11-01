/**
 * Renders generated interfaces inside markdown notes.
 *
 * A note fence is only transport: the same bytes the chat renders are parsed
 * and evaluated here, through the same `renderUiBlock` pipeline, so an embedded
 * layout keeps every widget the chat had. What changes is the ownership model:
 *  - the blocks own a private state store, so note widgets never reach the
 *    conversation-state persistence channel;
 *  - a block's lifetime follows the note DOM through `MarkdownRenderChild`;
 *  - actions that need the chat (continue the conversation, write into a note)
 *    are bridged to the plugin and degrade when it is unavailable.
 */

import {
  type App,
  type Component,
  type MarkdownPostProcessorContext,
  MarkdownRenderChild,
} from 'obsidian';

import { t } from '../../../i18n/i18n';
import { createTextLayoutEngine, resolveTextStyle } from '../../../utils/textLayout';
import { insertAtCursor } from '../actions/ActionableOutputController';
import { buildUiContinuationPrompt } from './ui/followUp';
import {
  MAX_UI_EMBED_CHARS,
  noteUiBlockKey,
  noteUiBlockKeyPrefix,
  UI_EMBED_LANGUAGES,
} from './ui/noteFence';
import { parseUiProgramCached } from './ui/parser';
import { collectUiProgramText, reserveEmbedHeight } from './ui/reservation';
import { UiStateStore } from './ui/stateStore';
import { createVaultUiRenderHost, type VaultUiRenderHostOptions } from './ui/vaultUiHost';
import {
  disposeUiBlock,
  hashUiBlockSource,
  pruneDetachedUiBlocks,
  renderUiBlock,
  type UiBlockCallbacks,
} from './UiBlockRenderer';

export type NoteUiEmbedHandler = (
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
) => void;

export interface NoteUiEmbedDeps {
  app: App;
  /** Registers a markdown code block processor; main passes the Plugin method. */
  registerCodeBlockProcessor(language: string, handler: NoteUiEmbedHandler): unknown;
  getSettings?(): { uiInsertToNoteEnabled?: boolean };
  /** Prefills the chat composer; only used by `@ToAssistant` inside an embed. */
  prefillChat?(prompt: string): void;
  /** Test seam over `MarkdownRenderer.render`. */
  renderMarkdown?: (
    el: HTMLElement,
    markdown: string,
    sourcePath: string,
    component: Component,
  ) => void;
}

export interface NoteUiEmbedHandle {
  dispose(): void;
}

/** Releases a block when Obsidian removes the rendered section it lives in. */
class NoteUiEmbedChild extends MarkdownRenderChild {
  private readonly release: () => void;

  constructor(container: HTMLElement, release: () => void) {
    super(container);
    this.release = release;
  }

  onunload(): void {
    this.release();
  }
}

/** A program the renderer cannot use stays visible as source instead of blank. */
function renderPlainProgram(el: HTMLElement, source: string): void {
  const pre = el.createEl('pre', { cls: 'claudian-plus-ui-embed-fallback' });
  pre.createEl('code', { text: source });
}

interface IdleWindow {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** An embed may wait at most this long for idle time, so it cannot stay blank. */
const EMBED_BUILD_IDLE_TIMEOUT_MS = 200;

/**
 * Defers a build to idle time in the note's own window.
 *
 * Returns a cancel function, or null when the environment cannot defer — in
 * that case the caller builds immediately, which is the behaviour before
 * deferral existed.
 */
function scheduleEmbedBuild(host: HTMLElement, build: () => void): (() => void) | null {
  const view = host.ownerDocument?.defaultView as (Window & IdleWindow) | null | undefined;
  if (view === null || view === undefined) return null;
  if (typeof view.requestIdleCallback !== 'function') return null;
  const cancelIdle = view.cancelIdleCallback;
  const handle = view.requestIdleCallback(() => build(), {
    timeout: EMBED_BUILD_IDLE_TIMEOUT_MS,
  });
  return () => {
    cancelIdle?.call(view, handle);
  };
}

export function registerNoteUiEmbed(deps: NoteUiEmbedDeps): NoteUiEmbedHandle {
  const { app } = deps;
  const store = new UiStateStore();
  /** Mounted block -> state key; also the occurrence index for duplicate fences. */
  const mounted = new Map<HTMLElement, string>();
  /** Off-DOM layout predictions for the reserved space of not-yet-built blocks. */
  const textLayout = createTextLayoutEngine();
  /** Measured height per block key, used instead of a prediction on rebuild. */
  const measuredHeights = new Map<string, number>();

  const nextOccurrence = (sourcePath: string, contentHash: string): number => {
    const prefix = noteUiBlockKeyPrefix(sourcePath, contentHash);
    let next = 0;
    for (const key of mounted.values()) {
      if (!key.startsWith(prefix)) continue;
      const index = Number(key.slice(prefix.length));
      if (Number.isFinite(index) && index >= next) next = index + 1;
    }
    return next;
  };

  /**
   * Space the block will occupy, so a deferred build never shifts the note.
   * A previously measured height wins over prediction; prediction needs the
   * note's own width and font, and degrades to the minimum when unavailable.
   */
  const reservationFor = (blockKey: string, source: string, wrapper: HTMLElement): number => {
    const measured = measuredHeights.get(blockKey);
    if (measured !== undefined) return measured;

    const style = resolveTextStyle(wrapper);
    const width = wrapper.clientWidth;
    if (style === null || !(width > 0)) return reserveEmbedHeight(null);
    try {
      const text = collectUiProgramText(parseUiProgramCached(source));
      if (text.length === 0) return reserveEmbedHeight(null);
      const prediction = textLayout.predict(text, style, width);
      return reserveEmbedHeight(prediction?.height ?? null);
    } catch {
      return reserveEmbedHeight(null);
    }
  };

  const createCallbacks = (sourcePath: string): UiBlockCallbacks => ({
    onContinueConversation: (prompt, context) => {
      deps.prefillChat?.(buildUiContinuationPrompt(prompt, context));
    },
    onOpenUrl: (url) => {
      activeWindow.open(url, '_blank', 'noopener');
    },
    onCopy: (text) => {
      void navigator.clipboard?.writeText(text);
    },
    onOpenNote: (linktext) => {
      void app.workspace.openLinkText(linktext, sourcePath, false);
    },
    onInsertToNote: (markdown) => {
      if (deps.getSettings?.().uiInsertToNoteEnabled !== true) return;
      insertAtCursor(app, markdown, { customNotice: t('settings.uiInsertToNote.modalTitle') });
    },
  });

  const renderEmbed = (
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): void => {
    const wrapper = el.createDiv({ cls: 'claudian-plus-ui-embed' });
    const container = wrapper.createDiv({ cls: 'claudian-plus-ui-block' });
    /** Set when the section unloads, so a late idle callback cannot build. */
    let cancelled = false;
    let cancelSchedule: (() => void) | null = null;
    const child = new NoteUiEmbedChild(container, () => {
      cancelled = true;
      cancelSchedule?.();
      cancelSchedule = null;
      disposeUiBlock(container);
      mounted.delete(container);
    });
    ctx.addChild(child);

    const contentHash = hashUiBlockSource(source);
    const blockKey = noteUiBlockKey(
      ctx.sourcePath,
      contentHash,
      nextOccurrence(ctx.sourcePath, contentHash),
    );
    mounted.set(container, blockKey);

    const hostOptions: VaultUiRenderHostOptions = {
      sourcePath: ctx.sourcePath,
      component: child,
    };
    if (deps.renderMarkdown !== undefined) {
      const renderMarkdown = deps.renderMarkdown;
      hostOptions.renderMarkdown = (markdownEl, markdown) => {
        renderMarkdown(markdownEl, markdown, ctx.sourcePath, child);
      };
    }

    // Reserve before building: the block is built off the note's first paint, so
    // its space has to exist already or the note reflows when it appears.
    wrapper.setCssProps({
      '--claudian-plus-ui-embed-reserve': `${String(reservationFor(blockKey, source, wrapper))}px`,
    });
    wrapper.classList.add('is-pending');

    const build = (): void => {
      cancelSchedule = null;
      if (cancelled) return;
      if (!container.isConnected) {
        mounted.delete(container);
        return;
      }
      let rendered: boolean;
      try {
        rendered = renderUiBlock(container, source, {
          blockKey,
          host: createVaultUiRenderHost(app, hostOptions),
          callbacks: createCallbacks(ctx.sourcePath),
          store,
        });
      } catch {
        rendered = false;
      }
      if (!rendered) {
        wrapper.remove();
        mounted.delete(container);
        renderPlainProgram(el, source);
        return;
      }
      wrapper.classList.remove('is-pending');
      const height = Math.round(container.getBoundingClientRect().height);
      measuredHeights.set(blockKey, Math.max(reserveEmbedHeight(null), height));
    };

    const cancel = scheduleEmbedBuild(wrapper, build);
    if (cancel === null) {
      build();
      return;
    }
    cancelSchedule = cancel;
  };

  const handle: NoteUiEmbedHandler = (source, el, ctx) => {
    if (source.trim().length === 0) return;
    if (source.length > MAX_UI_EMBED_CHARS) {
      renderPlainProgram(el, source);
      return;
    }
    try {
      renderEmbed(source, el, ctx);
    } catch {
      el.replaceChildren();
      renderPlainProgram(el, source);
    }
  };

  for (const language of UI_EMBED_LANGUAGES) {
    deps.registerCodeBlockProcessor(language, handle);
  }

  return {
    dispose: (): void => {
      for (const container of [...mounted.keys()]) disposeUiBlock(container);
      mounted.clear();
      measuredHeights.clear();
      textLayout.clear();
      pruneDetachedUiBlocks();
    },
  };
}
