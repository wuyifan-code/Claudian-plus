import * as fs from 'fs';
import * as nodePath from 'path';

import type { ExitPlanModeDecision } from '../../../core/types/tools';
import { InlineOptionList } from './InlineOptionList';
import type { RenderContentFn } from './MessageRenderer';

export class InlineExitPlanMode extends InlineOptionList<ExitPlanModeDecision> {
  private input: Record<string, unknown>;
  private signal?: AbortSignal;
  private renderContent?: RenderContentFn;
  private planPathPrefix?: string;
  private planContent: string | null = null;
  private planReadError: string | null = null;
  private abortHandler: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    input: Record<string, unknown>,
    resolve: (decision: ExitPlanModeDecision | null) => void,
    signal?: AbortSignal,
    renderContent?: RenderContentFn,
    planPathPrefix?: string,
  ) {
    super(containerEl, resolve);
    this.input = input;
    this.signal = signal;
    this.renderContent = renderContent;
    this.planPathPrefix = planPathPrefix;
  }

  render(): void {
    super.render();

    if (this.signal) {
      this.abortHandler = () => this.handleResolve(null);
      this.signal.addEventListener('abort', this.abortHandler, { once: true });
    }
  }

  protected getTitle(): string {
    return 'Plan complete';
  }

  protected renderBody(): void {
    this.planContent = this.readPlanContent();
    if (this.planContent) {
      const contentEl = this.rootEl.createDiv({ cls: 'claudian-plus-plan-content-preview' });
      if (this.renderContent) {
        void this.renderContent(contentEl, this.planContent);
      } else {
        contentEl.createDiv({ cls: 'claudian-plus-plan-content-text', text: this.planContent });
      }
    } else if (this.planReadError) {
      this.rootEl.createDiv({
        cls: 'claudian-plus-plan-content-preview claudian-plus-plan-read-error',
        text: `Could not read plan file: ${this.planReadError}. "Approve (new session)" will not include plan details.`,
      });
    }

    const allowedPrompts = this.input.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined;
    if (allowedPrompts && Array.isArray(allowedPrompts) && allowedPrompts.length > 0) {
      const permEl = this.rootEl.createDiv({ cls: 'claudian-plus-plan-permissions' });
      permEl.createDiv({ text: 'Requested permissions:', cls: 'claudian-plus-plan-permissions-label' });
      const listEl = permEl.createEl('ul', { cls: 'claudian-plus-plan-permissions-list' });
      for (const perm of allowedPrompts) {
        listEl.createEl('li', { text: perm.prompt });
      }
    }

    const actionsEl = this.rootEl.createDiv({ cls: 'claudian-plus-ask-list' });

    const newSessionRow = actionsEl.createDiv({ cls: 'claudian-plus-ask-item' });
    newSessionRow.addClass('is-focused');
    newSessionRow.createSpan({ text: '\u203A', cls: 'claudian-plus-ask-cursor' });
    newSessionRow.createSpan({ text: '1. ', cls: 'claudian-plus-ask-item-num' });
    newSessionRow.createSpan({ text: 'Approve (new session)', cls: 'claudian-plus-ask-item-label' });
    newSessionRow.addEventListener('click', () => {
      this.focusedIndex = 0;
      this.updateFocus();
      this.handleResolve({
        type: 'approve-new-session',
        planContent: this.extractPlanContent(),
      });
    });
    this.items.push(newSessionRow);

    const approveRow = actionsEl.createDiv({ cls: 'claudian-plus-ask-item' });
    approveRow.createSpan({ text: '\u00A0', cls: 'claudian-plus-ask-cursor' });
    approveRow.createSpan({ text: '2. ', cls: 'claudian-plus-ask-item-num' });
    approveRow.createSpan({ text: 'Approve (current session)', cls: 'claudian-plus-ask-item-label' });
    approveRow.addEventListener('click', () => {
      this.focusedIndex = 1;
      this.updateFocus();
      this.handleResolve({ type: 'approve' });
    });
    this.items.push(approveRow);

    const feedbackRow = actionsEl.createDiv({ cls: 'claudian-plus-ask-item claudian-plus-ask-custom-item' });
    feedbackRow.createSpan({ text: '\u00A0', cls: 'claudian-plus-ask-cursor' });
    feedbackRow.createSpan({ text: '3. ', cls: 'claudian-plus-ask-item-num' });
    this.feedbackInput = feedbackRow.createEl('input', {
      type: 'text',
      cls: 'claudian-plus-ask-custom-text',
      placeholder: 'Enter feedback to continue planning...',
    });
    this.feedbackInput.addEventListener('focus', () => { this.isInputFocused = true; });
    this.feedbackInput.addEventListener('blur', () => { this.isInputFocused = false; });
    feedbackRow.addEventListener('click', () => {
      this.focusedIndex = 2;
      this.updateFocus();
    });
    this.items.push(feedbackRow);
  }

  protected handleEnter(index: number): void {
    if (index === 0) {
      this.handleResolve({
        type: 'approve-new-session',
        planContent: this.extractPlanContent(),
      });
    } else if (index === 1) {
      this.handleResolve({ type: 'approve' });
    } else if (index === 2) {
      this.feedbackInput.focus();
    }
  }

  protected handleFeedbackSubmit(): void {
    this.handleResolve({ type: 'feedback', text: this.feedbackInput.value.trim() });
  }

  protected onResolveCleanup(): void {
    if (this.signal && this.abortHandler) {
      this.signal.removeEventListener('abort', this.abortHandler);
      this.abortHandler = null;
    }
  }

  private readPlanContent(): string | null {
    const planFilePath = this.input.planFilePath as string | undefined;
    if (!planFilePath) return null;

    const resolved = nodePath.resolve(planFilePath).replace(/\\/g, '/');
    if (!this.planPathPrefix || !resolved.includes(this.planPathPrefix)) {
      this.planReadError = 'path outside allowed plan directory';
      return null;
    }

    try {
      const content = fs.readFileSync(planFilePath, 'utf-8');
      return content.trim() || null;
    } catch (err) {
      this.planReadError = err instanceof Error ? err.message : 'unknown error';
      return null;
    }
  }

  private extractPlanContent(): string {
    if (this.planContent) {
      return `Implement this plan:\n\n${this.planContent}`;
    }
    return 'Implement the approved plan.';
  }
}
