import { InlineOptionList } from './InlineOptionList';

export type PlanApprovalDecision =
  | { type: 'implement' }
  | { type: 'revise'; text: string }
  | { type: 'cancel' };

export class InlinePlanApproval extends InlineOptionList<PlanApprovalDecision> {
  protected getTitle(): string {
    return 'Plan complete';
  }

  protected renderBody(): void {
    const actionsEl = this.rootEl.createDiv({ cls: 'claudian-plus-ask-list' });

    // 1. Implement
    const implementRow = actionsEl.createDiv({ cls: 'claudian-plus-ask-item' });
    implementRow.addClass('is-focused');
    implementRow.createSpan({ text: '\u203A', cls: 'claudian-plus-ask-cursor' });
    implementRow.createSpan({ text: '1. ', cls: 'claudian-plus-ask-item-num' });
    implementRow.createSpan({ text: 'Implement', cls: 'claudian-plus-ask-item-label' });
    implementRow.addEventListener('click', () => {
      this.focusedIndex = 0;
      this.updateFocus();
      this.handleResolve({ type: 'implement' });
    });
    this.items.push(implementRow);

    // 2. Revise (with feedback input)
    const reviseRow = actionsEl.createDiv({ cls: 'claudian-plus-ask-item claudian-plus-ask-custom-item' });
    reviseRow.createSpan({ text: '\u00A0', cls: 'claudian-plus-ask-cursor' });
    reviseRow.createSpan({ text: '2. ', cls: 'claudian-plus-ask-item-num' });
    this.feedbackInput = reviseRow.createEl('input', {
      type: 'text',
      cls: 'claudian-plus-ask-custom-text',
      placeholder: 'Enter feedback to revise plan...',
    });
    this.feedbackInput.addEventListener('focus', () => { this.isInputFocused = true; });
    this.feedbackInput.addEventListener('blur', () => { this.isInputFocused = false; });
    reviseRow.addEventListener('click', () => {
      this.focusedIndex = 1;
      this.updateFocus();
    });
    this.items.push(reviseRow);

    // 3. Cancel
    const cancelRow = actionsEl.createDiv({ cls: 'claudian-plus-ask-item' });
    cancelRow.createSpan({ text: '\u00A0', cls: 'claudian-plus-ask-cursor' });
    cancelRow.createSpan({ text: '3. ', cls: 'claudian-plus-ask-item-num' });
    cancelRow.createSpan({ text: 'Cancel', cls: 'claudian-plus-ask-item-label' });
    cancelRow.addEventListener('click', () => {
      this.focusedIndex = 2;
      this.updateFocus();
      this.handleResolve({ type: 'cancel' });
    });
    this.items.push(cancelRow);
  }

  protected handleEnter(index: number): void {
    if (index === 0) {
      this.handleResolve({ type: 'implement' });
    } else if (index === 1) {
      this.feedbackInput.focus();
    } else if (index === 2) {
      this.handleResolve({ type: 'cancel' });
    }
  }

  protected handleFeedbackSubmit(): void {
    this.handleResolve({ type: 'revise', text: this.feedbackInput.value.trim() });
  }
}
