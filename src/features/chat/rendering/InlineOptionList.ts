const HINTS_TEXT = 'Arrow keys to navigate \u00B7 Enter to select \u00B7 Esc to cancel';

/**
 * Shared inline "option list" widget used by plan-approval prompts.
 *
 * Renders a focusable option list with keyboard navigation, an optional
 * custom-feedback row, and resolve-once semantics.
 */
export abstract class InlineOptionList<TDecision> {
  protected containerEl: HTMLElement;
  protected resolveCallback: (decision: TDecision | null) => void;
  protected resolved = false;

  protected rootEl!: HTMLElement;
  protected focusedIndex = 0;
  protected items: HTMLElement[] = [];
  protected feedbackInput!: HTMLInputElement;
  protected isInputFocused = false;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private pendingFocusFrame: number | null = null;
  private focusFrameWindow: Window | null = null;

  constructor(
    containerEl: HTMLElement,
    resolve: (decision: TDecision | null) => void,
  ) {
    this.containerEl = containerEl;
    this.resolveCallback = resolve;
    this.boundKeyDown = (event) => this.handleKeyDown(event);
  }

  render(): void {
    this.rootEl = this.containerEl.createDiv({ cls: 'claudian-plus-plan-approval-inline' });
    this.rootEl.createDiv({ cls: 'claudian-plus-plan-inline-title', text: this.getTitle() });

    this.renderBody();

    this.rootEl.createDiv({ text: HINTS_TEXT, cls: 'claudian-plus-ask-hints' });

    this.rootEl.setAttribute('tabindex', '0');
    this.rootEl.addEventListener('keydown', this.boundKeyDown);

    const ownerWindow = this.rootEl.ownerDocument.defaultView ?? window;
    this.focusFrameWindow = ownerWindow;
    this.pendingFocusFrame = ownerWindow.requestAnimationFrame(() => {
      this.pendingFocusFrame = null;
      this.focusFrameWindow = null;
      if (this.resolved || this.rootEl?.isConnected === false) return;
      this.rootEl.focus();
      this.rootEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  destroy(): void {
    this.handleResolve(null);
  }

  protected abstract getTitle(): string;
  protected abstract renderBody(): void;
  protected abstract handleEnter(index: number): void;
  protected abstract handleFeedbackSubmit(): void;

  protected handleResolve(decision: TDecision | null): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.cancelPendingFocus();
    this.rootEl?.removeEventListener('keydown', this.boundKeyDown);
    this.onResolveCleanup();
    this.rootEl?.remove();
    this.resolveCallback(decision);
  }

  protected onResolveCleanup(): void {
    // Subclasses may release extra resources (e.g. abort listeners).
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.isComposing) return;

    if (this.isInputFocused) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.isInputFocused = false;
        this.feedbackInput.blur();
        this.rootEl.focus();
        return;
      }
      if (e.key === 'Enter' && this.feedbackInput.value.trim()) {
        e.preventDefault();
        e.stopPropagation();
        this.handleFeedbackSubmit();
        return;
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.focusedIndex = Math.min(this.focusedIndex + 1, this.items.length - 1);
        this.updateFocus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
        this.updateFocus();
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        this.handleEnter(this.focusedIndex);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve(null);
        break;
    }
  }

  protected updateFocus(): void {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const cursor = item.querySelector('.claudian-plus-ask-cursor');
      if (i === this.focusedIndex) {
        item.addClass('is-focused');
        if (cursor) cursor.textContent = '\u203A';
        item.scrollIntoView({ block: 'nearest' });

        if (item.hasClass('claudian-plus-ask-custom-item')) {
          const input = item.querySelector('.claudian-plus-ask-custom-text') as HTMLInputElement;
          if (input) {
            input.focus();
            this.isInputFocused = true;
          }
        }
      } else {
        item.removeClass('is-focused');
        if (cursor) cursor.textContent = '\u00A0';

        if (item.hasClass('claudian-plus-ask-custom-item') && this.isInputFocused) {
          const input = item.querySelector('.claudian-plus-ask-custom-text') as HTMLInputElement;
          if (input && this.rootEl.ownerDocument.activeElement === input) {
            input.blur();
            this.isInputFocused = false;
          }
        }
      }
    }
  }

  private cancelPendingFocus(): void {
    if (this.pendingFocusFrame !== null) {
      this.focusFrameWindow?.cancelAnimationFrame(this.pendingFocusFrame);
    }
    this.pendingFocusFrame = null;
    this.focusFrameWindow = null;
  }
}
