import type { App, ItemView } from 'obsidian';

import type { BrowserSelectionContext } from '../../../utils/browser';
import type { ComposerContextTray } from '../ui/ComposerContextTray';

const BROWSER_SELECTION_POLL_INTERVAL = 250;

type BrowserLikeWebview = HTMLElement & {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
};

export class BrowserSelectionController {
  private app: App;
  private contextTray: ComposerContextTray;
  private inputEl: HTMLElement;
  private onVisibilityChange: (() => void) | null;
  private storedSelection: BrowserSelectionContext | null = null;
  private pollInterval: number | null = null;
  private pollWindow: Window | null = null;
  private pollInFlightGeneration: number | null = null;
  private pollGeneration = 0;

  constructor(
    app: App,
    contextTray: ComposerContextTray,
    inputEl: HTMLElement,
    onVisibilityChange?: () => void
  ) {
    this.app = app;
    this.contextTray = contextTray;
    this.inputEl = inputEl;
    this.onVisibilityChange = onVisibilityChange ?? null;
  }

  start(): void {
    if (this.pollInterval !== null) return;
    this.pollGeneration += 1;
    const generation = this.pollGeneration;
    const ownerWindow = this.inputEl.ownerDocument.defaultView ?? window;
    this.pollWindow = ownerWindow;
    this.pollInterval = ownerWindow.setInterval(() => {
      void this.poll(generation);
    }, BROWSER_SELECTION_POLL_INTERVAL);
  }

  stop(): void {
    this.pollGeneration += 1;
    this.pollInFlightGeneration = null;
    if (this.pollInterval !== null) {
      (this.pollWindow ?? window).clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.pollWindow = null;
    this.clear();
  }

  private async poll(generation: number): Promise<void> {
    if (generation !== this.pollGeneration || this.pollInFlightGeneration === generation) return;
    this.pollInFlightGeneration = generation;
    try {
      const browserView = this.getActiveBrowserView();
      if (!browserView) {
        this.clearWhenInputIsNotFocused();
        return;
      }

      const selectedText = await this.extractSelectedText(browserView.containerEl);
      if (generation !== this.pollGeneration) {
        return;
      }
      if (selectedText) {
        const nextContext = this.buildContext(browserView.view, browserView.viewType, browserView.containerEl, selectedText);
        if (!this.isSameSelection(nextContext, this.storedSelection)) {
          this.storedSelection = nextContext;
          this.updateIndicator();
        }
      } else {
        this.clearWhenInputIsNotFocused();
      }
    } catch {
      // Ignore transient polling errors to keep selection tracking resilient.
    } finally {
      if (this.pollInFlightGeneration === generation) {
        this.pollInFlightGeneration = null;
      }
    }
  }

  private getActiveBrowserView(): { view: ItemView; viewType: string; containerEl: HTMLElement } | null {
    const activeLeaf = this.app.workspace.getMostRecentLeaf?.();
    const activeView = activeLeaf?.view as ItemView | undefined;
    const containerEl = (activeView as unknown as { containerEl?: HTMLElement }).containerEl;
    if (!activeView || !containerEl) return null;

    const viewType = activeView.getViewType?.() ?? '';
    if (!this.isBrowserLikeView(viewType, containerEl)) return null;

    return { view: activeView, viewType, containerEl };
  }

  private isBrowserLikeView(viewType: string, containerEl: HTMLElement): boolean {
    const normalized = viewType.toLowerCase();
    if (
      normalized.includes('surfing')
      || normalized.includes('browser')
      || normalized.includes('webview')
    ) {
      return true;
    }

    return Boolean(containerEl.querySelector('iframe, webview'));
  }

  private async extractSelectedText(containerEl: HTMLElement): Promise<string | null> {
    const ownerDoc = containerEl.ownerDocument;
    const docSelection = this.extractSelectionFromDocument(ownerDoc, containerEl);
    if (docSelection) return docSelection;

    const frameSelection = this.extractSelectionFromIframes(containerEl);
    if (frameSelection) return frameSelection;

    return await this.extractSelectionFromWebviews(containerEl);
  }

  private extractSelectionFromDocument(doc: Document, scopeEl: HTMLElement): string | null {
    const selection = doc.getSelection();
    const selectedText = selection?.toString().trim();
    if (selectedText) {
      const anchorNode = selection?.anchorNode;
      const focusNode = selection?.focusNode;
      if ((anchorNode && scopeEl.contains(anchorNode)) || (focusNode && scopeEl.contains(focusNode))) {
        return selectedText;
      }
    }

    return this.extractSelectionFromActiveInput(doc, scopeEl);
  }

  private extractSelectionFromActiveInput(doc: Document, scopeEl: HTMLElement): string | null {
    const activeEl = doc.activeElement;
    if (!activeEl || !scopeEl.contains(activeEl)) return null;

    // `instanceof HTMLInputElement` uses the main renderer's constructor and
    // fails for inputs hosted in an Obsidian pop-out window. Tag names retain
    // the same semantics across document realms.
    const tagName = activeEl.tagName.toLowerCase();
    if (tagName !== 'textarea' && tagName !== 'input') return null;

    const input = activeEl as HTMLTextAreaElement | HTMLInputElement;
    const { value, selectionStart, selectionEnd } = input;
    if (typeof selectionStart !== 'number' || typeof selectionEnd !== 'number' || selectionStart === selectionEnd) return null;
    return value.slice(selectionStart, selectionEnd).trim() || null;

  }

  private extractSelectionFromIframes(containerEl: HTMLElement): string | null {
    const iframes = Array.from(containerEl.querySelectorAll('iframe'));
    for (const iframe of iframes) {
      try {
        const frameDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
        if (!frameDoc || !frameDoc.body) continue;

        const frameSelection = this.extractSelectionFromDocument(frameDoc, frameDoc.body);
        if (frameSelection) return frameSelection;
      } catch {
        // Ignore inaccessible iframe contexts (cross-origin restrictions).
      }
    }
    return null;
  }

  private async extractSelectionFromWebviews(containerEl: HTMLElement): Promise<string | null> {
    const webviews = Array.from(containerEl.querySelectorAll<BrowserLikeWebview>('webview'));
    for (const webview of webviews) {
      if (typeof webview.executeJavaScript !== 'function') continue;
      try {
        const result = await webview.executeJavaScript(
          'window.getSelection ? window.getSelection().toString() : ""',
          true
        );
        if (typeof result === 'string' && result.trim()) {
          return result.trim();
        }
      } catch {
        // Ignore inaccessible webview contexts.
      }
    }
    return null;
  }

  private buildContext(
    view: ItemView,
    viewType: string,
    containerEl: HTMLElement,
    selectedText: string
  ): BrowserSelectionContext {
    const title = this.extractViewTitle(view);
    const url = this.extractViewUrl(view, containerEl);
    const source = url ? `browser:${url}` : `browser:${viewType || 'unknown'}`;

    return {
      source,
      selectedText,
      title,
      url,
    };
  }

  private extractViewTitle(view: ItemView): string | undefined {
    const displayText = view.getDisplayText?.();
    if (displayText?.trim()) return displayText.trim();

    const title = (view as unknown as { title?: unknown }).title;
    return typeof title === 'string' && title.trim() ? title.trim() : undefined;
  }

  private extractViewUrl(view: ItemView, containerEl: HTMLElement): string | undefined {
    const rawView = view as unknown as Record<string, unknown>;
    const directCandidates = [
      rawView.url,
      rawView.currentUrl,
      rawView.currentURL,
      rawView.src,
    ];

    for (const candidate of directCandidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    const embeddableEl = containerEl.querySelector<HTMLElement>('iframe[src], webview[src]');
    const embeddedSrc = embeddableEl?.getAttribute('src');
    if (embeddedSrc?.trim()) {
      return embeddedSrc.trim();
    }

    return undefined;
  }

  private isSameSelection(
    left: BrowserSelectionContext | null,
    right: BrowserSelectionContext | null
  ): boolean {
    if (!left || !right) return false;
    return left.source === right.source
      && left.selectedText === right.selectedText
      && left.title === right.title
      && left.url === right.url;
  }

  private clearWhenInputIsNotFocused(): void {
    if (this.inputEl.ownerDocument.activeElement === this.inputEl) return;
    if (this.storedSelection) {
      this.storedSelection = null;
      this.updateIndicator();
    }
  }

  private updateIndicator(): void {
    if (this.storedSelection) {
      const lineCount = this.storedSelection.selectedText.split(/\r?\n/).length;
      const lineLabel = lineCount === 1 ? 'line' : 'lines';
      const label = `${lineCount} ${lineLabel} selected`;
      this.contextTray.setItems('browser-selection', [{
        id: 'browser-selection',
        kind: 'selection',
        label,
        icon: 'globe',
        ariaLabel: label,
        onRemove: () => this.clear(),
      }]);
    } else {
      this.contextTray.clearItems('browser-selection');
    }
    this.updateContextRowVisibility();
  }

  updateContextRowVisibility(): void {
    this.onVisibilityChange?.();
  }

  getContext(): BrowserSelectionContext | null {
    return this.storedSelection;
  }

  hasSelection(): boolean {
    return this.storedSelection !== null;
  }

  clear(): void {
    this.storedSelection = null;
    this.updateIndicator();
  }
}
