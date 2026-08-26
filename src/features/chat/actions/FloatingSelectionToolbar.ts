import { type App, Notice, setIcon } from 'obsidian';

import { localeText } from '../../../i18n/i18n';
import {
  createLinkedNote,
  insertAtCursor,
  replaceSelection,
} from './ActionableOutputController';

export interface FloatingSelectionToolbarOptions {
  app: App;
  containerEl: HTMLElement;
}

export class FloatingSelectionToolbar {
  private app: App;
  private containerEl: HTMLElement;
  private toolbarEl: HTMLElement | null = null;
  private activeSelectionText: string | null = null;
  private isDisposed = false;
  private hideTimeout: number | null = null;
  private isMouseDownOnToolbar = false;

  private onPointerUpHandler = (): void => this.handleSelectionUpdate();
  private onKeyUpHandler = (): void => this.handleSelectionUpdate();
  private onSelectionChangeHandler = (): void => this.handleSelectionUpdate();
  private onScrollHandler = (): void => {
    if (this.toolbarEl?.classList.contains('is-visible')) {
      this.updatePosition();
    }
  };

  constructor(options: FloatingSelectionToolbarOptions) {
    this.app = options.app;
    this.containerEl = options.containerEl;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.containerEl.addEventListener('mouseup', this.onPointerUpHandler);
    this.containerEl.addEventListener('keyup', this.onKeyUpHandler);

    const doc = this.containerEl.ownerDocument ?? (typeof activeDocument !== 'undefined' ? activeDocument : null);
    doc?.addEventListener('selectionchange', this.onSelectionChangeHandler);
    this.containerEl.addEventListener('scroll', this.onScrollHandler, { passive: true });
  }

  private getOrCreateToolbar(): HTMLElement {
    if (this.toolbarEl && this.toolbarEl.isConnected) {
      return this.toolbarEl;
    }

    const toolbar = this.containerEl.createDiv({
      cls: 'claudian-plus-floating-selection-toolbar',
    });

    // Prevent clicking on the toolbar from clearing the DOM selection
    toolbar.addEventListener('mousedown', (e) => {
      this.isMouseDownOnToolbar = true;
      e.preventDefault();
      e.stopPropagation();
    });

    toolbar.addEventListener('mouseup', (e) => {
      e.stopPropagation();
      window.setTimeout(() => {
        this.isMouseDownOnToolbar = false;
      }, 50);
    });

    // 1. Insert at Cursor
    const insertBtn = toolbar.createEl('button', {
      cls: 'claudian-plus-floating-btn claudian-plus-floating-insert-btn',
      attr: {
        title: localeText('插入到光标处', 'Insert at cursor'),
        'aria-label': localeText('插入到光标处', 'Insert at cursor'),
      },
    });
    setIcon(insertBtn, 'corner-down-left');
    insertBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.activeSelectionText) return;
      insertAtCursor(this.app, this.activeSelectionText, { isSelection: true });
      this.hide();
    });

    // 2. Replace Selection
    const replaceBtn = toolbar.createEl('button', {
      cls: 'claudian-plus-floating-btn claudian-plus-floating-replace-btn',
      attr: {
        title: localeText('替换笔记选区', 'Replace note selection'),
        'aria-label': localeText('替换笔记选区', 'Replace note selection'),
      },
    });
    setIcon(replaceBtn, 'file-edit');
    replaceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.activeSelectionText) return;
      replaceSelection(this.app, this.activeSelectionText, null, { isSelection: true });
      this.hide();
    });

    // 3. Copy
    const copyBtn = toolbar.createEl('button', {
      cls: 'claudian-plus-floating-btn claudian-plus-floating-copy-btn',
      attr: {
        title: localeText('复制选区', 'Copy selection'),
        'aria-label': localeText('复制选区', 'Copy selection'),
      },
    });
    setIcon(copyBtn, 'copy');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.activeSelectionText) return;
      void navigator.clipboard.writeText(this.activeSelectionText).then(() => {
        new Notice(localeText('已复制选区到剪贴板', 'Copied selection to clipboard'));
      }).catch(() => {
        // clipboard may fail in non-secure contexts
      });
      this.hide();
    });

    // 4. Create Linked Note
    const noteBtn = toolbar.createEl('button', {
      cls: 'claudian-plus-floating-btn claudian-plus-floating-note-btn',
      attr: {
        title: localeText('创建关联笔记', 'Create linked note'),
        'aria-label': localeText('创建关联笔记', 'Create linked note'),
      },
    });
    setIcon(noteBtn, 'file-plus');
    noteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.activeSelectionText) return;
      void createLinkedNote(this.app, this.activeSelectionText);
      this.hide();
    });

    this.toolbarEl = toolbar;
    return toolbar;
  }

  private handleSelectionUpdate(): void {
    if (this.isDisposed || this.isMouseDownOnToolbar) return;

    const doc = this.containerEl.ownerDocument ?? (typeof activeDocument !== 'undefined' ? activeDocument : null);
    const selection = doc?.defaultView?.getSelection?.() ?? (typeof window !== 'undefined' ? window.getSelection?.() : null);

    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      this.hide();
      return;
    }

    try {
      const range = selection.getRangeAt(0);

      // Only show if selection is inside an assistant message / text block within our container
      const isInsideAssistantMessage = this.isSelectionInsideAssistant(range);
      if (!isInsideAssistantMessage) {
        this.hide();
        return;
      }

      const text = selection.toString().trim();
      if (!text || text.length === 0) {
        this.hide();
        return;
      }

      this.activeSelectionText = text;
      this.show(range);
    } catch {
      this.hide();
    }
  }

  private isSelectionInsideAssistant(range: Range): boolean {
    const commonNode = range.commonAncestorContainer.nodeType === 1
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement;

    if (!commonNode || !this.containerEl.contains(commonNode)) {
      return false;
    }

    // Must be within assistant message, text block, or code block
    const assistantMsg = commonNode.closest('.claudian-plus-message-assistant') ?? commonNode.closest('.claudian-plus-assistant');
    const textBlock = commonNode.closest('.claudian-plus-text-block');
    const codeWrapper = commonNode.closest('.claudian-plus-code-wrapper');

    return !!(assistantMsg || textBlock || codeWrapper);
  }

  public show(range: Range): void {
    if (this.hideTimeout !== null) {
      window.clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    const toolbar = this.getOrCreateToolbar();
    this.updatePosition(range);
    toolbar.classList.add('is-visible');
  }

  public hide(): void {
    if (!this.toolbarEl) return;
    this.toolbarEl.classList.remove('is-visible');
    this.activeSelectionText = null;
  }

  private updatePosition(explicitRange?: Range): void {
    if (!this.toolbarEl) return;

    let range = explicitRange;
    if (!range) {
      const doc = this.containerEl.ownerDocument ?? (typeof activeDocument !== 'undefined' ? activeDocument : null);
      const selection = doc?.defaultView?.getSelection?.() ?? (typeof window !== 'undefined' ? window.getSelection?.() : null);
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        range = selection.getRangeAt(0);
      }
    }

    if (!range) {
      this.hide();
      return;
    }

    const rangeRect = range.getBoundingClientRect();
    const containerRect = this.containerEl.getBoundingClientRect();

    if (rangeRect.width === 0 && rangeRect.height === 0) {
      return;
    }

    const toolbarWidth = this.toolbarEl.offsetWidth || 140;
    const toolbarHeight = this.toolbarEl.offsetHeight || 32;

    // Center toolbar horizontally over selection
    const selectionCenterX = rangeRect.left + rangeRect.width / 2;
    let left = selectionCenterX - containerRect.left - toolbarWidth / 2;

    // Clamp within container horizontal bounds
    const minLeft = 6;
    const maxLeft = Math.max(minLeft, containerRect.width - toolbarWidth - 6);
    left = Math.max(minLeft, Math.min(left, maxLeft));

    // Position above selection if space permits, else below
    let top = rangeRect.top - containerRect.top - toolbarHeight - 8;
    if (top < 4) {
      top = rangeRect.bottom - containerRect.top + 8;
    }

    this.toolbarEl.style.left = `${left}px`;
    this.toolbarEl.style.top = `${top}px`;
  }

  public destroy(): void {
    this.isDisposed = true;
    if (this.hideTimeout !== null) {
      window.clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    this.containerEl.removeEventListener('mouseup', this.onPointerUpHandler);
    this.containerEl.removeEventListener('keyup', this.onKeyUpHandler);

    const doc = this.containerEl.ownerDocument ?? (typeof activeDocument !== 'undefined' ? activeDocument : null);
    doc?.removeEventListener('selectionchange', this.onSelectionChangeHandler);
    this.containerEl.removeEventListener('scroll', this.onScrollHandler);

    if (this.toolbarEl) {
      this.toolbarEl.remove();
      this.toolbarEl = null;
    }
  }
}

