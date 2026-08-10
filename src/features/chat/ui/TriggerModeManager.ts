import { Notice } from 'obsidian';

export interface TriggerModeManagerCallbacks {
  onSubmit: (rawText: string) => Promise<void>;
  getInputWrapper: () => HTMLElement | null;
  resetInputHeight?: () => void;
}

export interface TriggerModeManagerOptions {
  /** Key that enters the mode when typed into an empty input. */
  triggerKey: string;
  /** Wrapper class applied while the mode is active. */
  modeClass: string;
  /** Placeholder shown while the mode is active. */
  placeholder: string;
  /** Exit the mode when the input becomes empty. */
  autoExitOnEmpty?: boolean;
  /** Consume Enter even when the input is empty. */
  blockEmptySubmit?: boolean;
  /** Clear the input before invoking onSubmit. */
  clearBeforeSubmit?: boolean;
  /** Surface submit failures through a Notice. */
  showSubmitError?: boolean;
}

/**
 * Shared trigger-char mode manager. Enters a "mode" when the trigger key is
 * typed into an empty input, then owns Enter-to-submit and Escape-to-cancel.
 */
export abstract class TriggerModeManager {
  private active = false;
  private rawText = '';
  private isSubmitting = false;
  private readonly originalPlaceholder: string;

  constructor(
    protected readonly inputEl: HTMLTextAreaElement,
    protected readonly callbacks: TriggerModeManagerCallbacks,
    private readonly options: TriggerModeManagerOptions,
  ) {
    this.originalPlaceholder = inputEl.placeholder;
  }

  handleTriggerKey(e: KeyboardEvent): boolean {
    if (!this.active && this.inputEl.value === '' && e.key === this.options.triggerKey) {
      if (this.enterMode()) {
        e.preventDefault();
        return true;
      }
    }
    return false;
  }

  handleInputChange(): void {
    if (!this.active) return;

    const text = this.inputEl.value;
    if (text === '' && this.options.autoExitOnEmpty) {
      this.exitMode();
    } else {
      this.rawText = text;
    }
  }

  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.active) return false;

    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      if (!this.rawText.trim()) {
        if (this.options.blockEmptySubmit) {
          e.preventDefault();
          return true;
        }
        return false;
      }

      e.preventDefault();
      void this.submit();
      return true;
    }

    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      this.clear();
      return true;
    }

    return false;
  }

  isActive(): boolean {
    return this.active;
  }

  protected getRawText(): string {
    return this.rawText;
  }

  clear(): void {
    this.inputEl.value = '';
    this.exitMode();
    this.callbacks.resetInputHeight?.();
  }

  destroy(): void {
    this.exitMode();
  }

  private async submit(): Promise<void> {
    if (this.isSubmitting) return;

    const rawText = this.rawText.trim();
    if (!rawText) return;

    this.isSubmitting = true;

    try {
      if (this.options.clearBeforeSubmit) {
        this.clear();
      }
      await this.callbacks.onSubmit(rawText);
    } catch (error) {
      if (this.options.showSubmitError) {
        new Notice(`Command failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  private enterMode(): boolean {
    const wrapper = this.callbacks.getInputWrapper();
    if (!wrapper) return false;

    wrapper.addClass(this.options.modeClass);
    this.active = true;
    this.rawText = '';
    this.inputEl.placeholder = this.options.placeholder;
    return true;
  }

  private exitMode(): void {
    const wrapper = this.callbacks.getInputWrapper();
    if (wrapper) {
      wrapper.removeClass(this.options.modeClass);
    }
    this.active = false;
    this.rawText = '';
    this.inputEl.placeholder = this.originalPlaceholder;
  }
}
