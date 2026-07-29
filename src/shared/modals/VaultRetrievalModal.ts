import type { App } from 'obsidian';
import { Modal, Notice, setIcon, TFile } from 'obsidian';

import type { VaultRetrievalResult } from '../../core/retrieval/VaultRetrievalService';

export interface VaultRetrievalModalOptions {
  title: string;
  query: string;
  results: VaultRetrievalResult[];
  prompt?: string;
  onAskAgent?: (prompt: string) => void;
  /** Insert a traceable wiki-link for a selected source into the active note. */
  onInsertReference?: (result: VaultRetrievalResult) => void;
  /** Render as a compact candidate picker instead of a full source browser. */
  compact?: boolean;
  /** Adds a short confidence note to the compact header. */
  highConfidenceOnly?: boolean;
  /** Called when the modal is closed, including after an automatic suggestion. */
  onClose?: () => void;
}

/** Displays local retrieval sources and keeps every insight traceable. */
export class VaultRetrievalModal extends Modal {
  constructor(app: App, private readonly options: VaultRetrievalModalOptions) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.options.title);
    this.modalEl.addClass('claudian-plus-vault-retrieval-modal');
    if (this.options.compact) this.modalEl.addClass('claudian-plus-vault-retrieval-compact');

    const { contentEl } = this;
    contentEl.createDiv({
      cls: 'claudian-plus-vault-retrieval-query',
      text: this.options.query ? `与“${this.options.query}”相关` : '相关笔记',
    });
    if (this.options.highConfidenceOnly) {
      contentEl.createDiv({
        cls: 'claudian-plus-vault-retrieval-confidence-note',
        text: '仅显示高置信度的本地匹配，不会自动插入。',
      });
    }

    if (this.options.results.length === 0) {
      contentEl.createDiv({
        cls: 'claudian-plus-vault-retrieval-empty',
        text: 'No matching Markdown sources were found.',
      });
      return;
    }

    const list = contentEl.createDiv({ cls: 'claudian-plus-vault-retrieval-list' });
    for (const [index, result] of this.options.results.entries()) {
      const item = list.createDiv({ cls: 'claudian-plus-vault-retrieval-item' });
      const header = item.createDiv({ cls: 'claudian-plus-vault-retrieval-item-header' });
      const openButton = header.createEl('button', {
        cls: 'claudian-plus-vault-retrieval-source',
        attr: { type: 'button' },
      });
      setIcon(openButton, 'file-text');
      openButton.createSpan({ text: `[${index + 1}] ${result.path}${result.heading ? ` · ${result.heading}` : ''}` });
      openButton.addEventListener('click', () => {
        const file = this.app.vault.getAbstractFileByPath(result.path);
        if (!(file instanceof TFile)) {
          new Notice(`Could not open ${result.path}`);
          return;
        }
        void this.app.workspace.getLeaf().openFile(file);
      });

      item.createDiv({ cls: 'claudian-plus-vault-retrieval-excerpt', text: result.excerpt });
      const metadata = item.createDiv({ cls: 'claudian-plus-vault-retrieval-metadata' });
      metadata.createSpan({
        cls: 'claudian-plus-vault-retrieval-confidence',
        text: formatConfidence(result),
      });
      if (result.recommendationReason) {
        metadata.createSpan({
          cls: 'claudian-plus-vault-retrieval-reason',
          text: result.recommendationReason,
        });
      }

      if (this.options.onInsertReference) {
        const actions = item.createDiv({ cls: 'claudian-plus-vault-retrieval-item-actions' });
        const insertButton = actions.createEl('button', {
          cls: 'claudian-plus-vault-retrieval-insert-link',
          text: '插入双链',
          attr: { type: 'button' },
        });
        insertButton.addEventListener('click', () => {
          this.options.onInsertReference?.(result);
        });
      }
    }

    if (this.options.prompt && this.options.onAskAgent) {
      const actions = contentEl.createDiv({ cls: 'claudian-plus-vault-retrieval-actions' });
      const askButton = actions.createEl('button', {
        cls: 'mod-cta',
        text: 'Ask agent for an insight',
        attr: { type: 'button' },
      });
      askButton.addEventListener('click', () => {
        this.options.onAskAgent?.(this.options.prompt!);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
    this.modalEl.removeClass('claudian-plus-vault-retrieval-modal');
    this.modalEl.removeClass('claudian-plus-vault-retrieval-compact');
    this.options.onClose?.();
  }
}

function formatConfidence(result: VaultRetrievalResult): string {
  if (result.semanticScore !== undefined) {
    return `强匹配 · ${Math.round(Math.max(0, Math.min(1, result.semanticScore)) * 100)}%`;
  }
  return `匹配度 · ${Math.round(Math.max(0, Math.min(1, result.score)) * 100)}%`;
}
