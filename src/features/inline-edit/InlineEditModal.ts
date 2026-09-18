import { type App, type Editor, type MarkdownView, Modal, setIcon } from 'obsidian';

import { localeText } from '../../i18n/i18n';
import type { EditorSelectionContext } from '../../utils/editor';
import { InlineEditContextExtractor } from './InlineEditContextExtractor';
import type { InlineEditService } from './InlineEditService';
import type { InlineEditResult, InlineEditStatus } from './types';

export interface InlineEditModalOptions {
  app: App;
  editor: Editor;
  view: MarkdownView;
  service: InlineEditService;
  context?: EditorSelectionContext;
}

export class InlineEditModal extends Modal {
  private editor: Editor;
  private view: MarkdownView;
  private service: InlineEditService;
  private context: EditorSelectionContext;
  private status: InlineEditStatus = 'idle';
  private currentResult: InlineEditResult | null = null;
  private abortController: AbortController | null = null;

  private inputEl: HTMLTextAreaElement | null = null;
  private diffContainerEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private acceptBtn: HTMLButtonElement | null = null;
  private generateBtn: HTMLButtonElement | null = null;

  constructor(options: InlineEditModalOptions) {
    super(options.app);
    this.editor = options.editor;
    this.view = options.view;
    this.service = options.service;
    this.context = options.context ?? InlineEditContextExtractor.extract(options.editor, options.view);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('claudian-plus-inline-edit-modal');

    // Header
    const headerEl = contentEl.createDiv({ cls: 'claudian-plus-inline-edit-header' });
    const titleRow = headerEl.createDiv({ cls: 'claudian-plus-inline-edit-title-row' });
    const iconEl = titleRow.createSpan({ cls: 'claudian-plus-inline-edit-icon' });
    setIcon(iconEl, 'sparkles');
    titleRow.createEl('h4', {
      text: localeText('行内 AI 编辑', 'Inline Edit with AI'),
      cls: 'claudian-plus-inline-edit-title',
    });

    const closeBtn = titleRow.createEl('button', {
      cls: 'claudian-plus-inline-edit-close-btn',
      attr: { 'aria-label': 'Close' },
    });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => this.rejectAndClose());

    // Context summary badge
    const contextBadge = headerEl.createDiv({ cls: 'claudian-plus-inline-edit-context-badge' });
    if (this.context.mode === 'selection') {
      contextBadge.setText(
        `${localeText('已选行数: ', 'Selected lines: ')}${this.context.lineCount ?? 1}`
      );
    } else {
      contextBadge.setText(localeText('光标插入位置', 'Cursor insertion point'));
    }

    // Input area
    const inputWrapper = contentEl.createDiv({ cls: 'claudian-plus-inline-edit-input-wrapper' });
    this.inputEl = inputWrapper.createEl('textarea', {
      cls: 'claudian-plus-inline-edit-input',
      attr: {
        placeholder: localeText(
          '描述你想要的修改或生成内容... (Enter 生成, Shift+Enter 换行)',
          'Describe changes or text to generate... (Enter to generate, Shift+Enter for newline)'
        ),
        rows: '2',
      },
    });

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault?.();
        if (this.currentResult) {
          this.acceptAndApply();
        } else {
          void this.startGeneration();
        }
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault?.();
        void this.startGeneration();
      } else if (e.key === 'Escape') {
        e.preventDefault?.();
        this.rejectAndClose();
      }
    });

    // Diff preview container
    this.diffContainerEl = contentEl.createDiv({ cls: 'claudian-plus-inline-edit-diff claudian-plus-hidden' });

    // Status bar
    this.statusEl = contentEl.createDiv({ cls: 'claudian-plus-inline-edit-status' });

    // Footer actions
    const footerEl = contentEl.createDiv({ cls: 'claudian-plus-inline-edit-footer' });

    const cancelBtn = footerEl.createEl('button', {
      cls: 'claudian-plus-inline-edit-btn claudian-plus-inline-edit-cancel-btn',
      text: localeText('取消 (Esc)', 'Cancel (Esc)'),
    });
    cancelBtn.addEventListener('click', () => this.rejectAndClose());

    this.generateBtn = footerEl.createEl('button', {
      cls: 'claudian-plus-inline-edit-btn mod-cta',
      text: localeText('生成 (Enter)', 'Generate (Enter)'),
    });
    this.generateBtn.addEventListener('click', () => {
      void this.startGeneration();
    });

    this.acceptBtn = footerEl.createEl('button', {
      cls: 'claudian-plus-inline-edit-btn mod-cta claudian-plus-hidden',
      text: localeText('采纳并应用 (Mod+Enter)', 'Accept (Mod+Enter)'),
    });
    this.acceptBtn.addEventListener('click', () => this.acceptAndApply());

    // Focus input on open
    window.setTimeout(() => {
      this.inputEl?.focus();
    }, 50);
  }

  private async startGeneration(): Promise<void> {
    const instruction = this.inputEl?.value.trim();
    if (!instruction) return;

    this.status = 'generating';
    this.statusEl?.setText(localeText('正在生成修改建议...', 'Generating diff...'));
    this.generateBtn?.setAttribute('disabled', 'true');
    this.diffContainerEl?.removeClass('claudian-plus-hidden');

    this.abortController = new AbortController();

    try {
      const result = await this.service.generateEdit(
        {
          instruction,
          context: this.context,
        },
        {
          abortController: this.abortController,
          onChunk: (interim) => {
            this.currentResult = interim;
            this.renderDiff(interim);
          },
        }
      );

      this.status = 'previewing';
      this.currentResult = result;
      this.renderDiff(result);

      this.statusEl?.setText(
        localeText('修改预览已就绪。按 Mod+Enter 采纳。', 'Diff preview ready. Press Mod+Enter to accept.')
      );
      this.acceptBtn?.removeClass('claudian-plus-hidden');
    } catch (err: unknown) {
      if (this.abortController?.signal.aborted) return;
      this.status = 'error';
      const message = err instanceof Error ? err.message : String(err);
      this.statusEl?.setText(`${localeText('生成出错: ', 'Error: ')}${message}`);
    } finally {
      this.generateBtn?.removeAttribute('disabled');
      this.abortController = null;
    }
  }

  private renderDiff(result: InlineEditResult): void {
    if (!this.diffContainerEl) return;
    this.diffContainerEl.empty();

    const diffListEl = this.diffContainerEl.createDiv({ cls: 'claudian-plus-diff-lines-list' });

    for (const line of result.diffLines) {
      const row = diffListEl.createDiv({
        cls: `claudian-plus-diff-line claudian-plus-diff-${line.type}`,
      });
      const prefix = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ';
      row.createSpan({ cls: 'claudian-plus-diff-prefix', text: prefix });
      row.createSpan({ cls: 'claudian-plus-diff-text', text: line.text || ' ' });
    }
  }

  acceptAndApply(): void {
    if (!this.currentResult) {
      this.close();
      return;
    }

    const replacement = this.currentResult.replacementText;

    if (this.context.mode === 'selection') {
      if (this.context.selectionRange) {
        this.editor.replaceRange(
          replacement,
          this.context.selectionRange.from,
          this.context.selectionRange.to
        );
      } else {
        this.editor.replaceSelection(replacement);
      }
    } else {
      const cursor = this.editor.getCursor();
      this.editor.replaceRange(replacement, cursor);
    }

    this.status = 'accepted';
    this.close();
  }

  rejectAndClose(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.status = 'rejected';
    this.close();
  }

  onClose(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.contentEl.empty();
  }
}
