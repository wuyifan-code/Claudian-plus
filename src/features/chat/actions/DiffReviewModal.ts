import type { App } from 'obsidian';
import { Modal } from 'obsidian';

import { localeText } from '../../../i18n/i18n';
import { computeUnifiedLineDiff, countLineChanges } from '../../../utils/diff';
import { renderDiffContent, renderDiffStats } from '../rendering/DiffRenderer';

export interface DiffReviewModalOptions {
  app: App;
  filePath?: string;
  oldContent: string;
  newContent: string;
  onApply: (content: string) => void;
}

export class DiffReviewModal extends Modal {
  private readonly filePath?: string;
  private readonly oldContent: string;
  private readonly newContent: string;
  private readonly onApply: (content: string) => void;

  constructor(options: DiffReviewModalOptions) {
    super(options.app);
    this.filePath = options.filePath;
    this.oldContent = options.oldContent;
    this.newContent = options.newContent;
    this.onApply = options.onApply;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('claudian-plus-diff-review-modal');

    // Header
    const headerEl = contentEl.createDiv({ cls: 'claudian-plus-diff-review-header' });
    headerEl.createEl('h3', { text: localeText('Diff 审查与原位合并', 'Diff review & in-situ mutation') });

    if (this.filePath) {
      headerEl.createSpan({
        cls: 'claudian-plus-diff-review-file-badge',
        text: this.filePath,
      });
    }

    const diffLines = computeUnifiedLineDiff(this.oldContent, this.newContent);
    const stats = countLineChanges(diffLines);

    const statsEl = headerEl.createDiv({ cls: 'claudian-plus-diff-review-stats' });
    renderDiffStats(statsEl, stats);

    // Diff Content Viewer
    const scrollContainerEl = contentEl.createDiv({ cls: 'claudian-plus-diff-review-body' });
    const diffContentEl = scrollContainerEl.createDiv({ cls: 'claudian-plus-diff-container' });
    renderDiffContent(diffContentEl, diffLines);

    // Action Footer
    const footerEl = contentEl.createDiv({ cls: 'claudian-plus-diff-review-footer' });

    const cancelBtn = footerEl.createEl('button', {
      text: localeText('取消', 'Cancel'),
      cls: 'claudian-plus-diff-review-cancel',
    });
    cancelBtn.addEventListener('click', () => {
      this.close();
    });

    const applyBtn = footerEl.createEl('button', {
      text: localeText('应用更改', 'Apply changes'),
      cls: 'mod-cta claudian-plus-diff-review-apply',
    });
    applyBtn.addEventListener('click', () => {
      this.onApply(this.newContent);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
