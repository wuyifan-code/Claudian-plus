import { t } from '../../../i18n/i18n';
import type { FeedbackBus } from '../../../shared/feedback/FeedbackBus';
import type { FeedbackEntry, FeedbackState } from '../../../shared/feedback/types';

/**
 * Durable home for a failed turn.
 *
 * Toasts are reminders; this row stays under the last message until the user
 * retries or starts the next turn, so "it failed and I missed it" cannot happen.
 * It is also the seam 3.2.12 builds the full turn-status bar on.
 */
export class TurnErrorSlot {
  private readonly containerEl: HTMLElement;
  private readonly unsubscribe: () => void;
  private elementEl: HTMLElement | null = null;
  private entry: FeedbackEntry | null = null;

  constructor(containerEl: HTMLElement, bus: FeedbackBus) {
    this.containerEl = containerEl;
    this.unsubscribe = bus.subscribe(state => {
      this.onState(state);
    });
  }

  /** Called when the next turn is dispatched. */
  clear(): void {
    this.entry = null;
    this.elementEl?.remove();
    this.elementEl = null;
  }

  dispose(): void {
    this.unsubscribe();
    this.clear();
  }

  private onState(state: FeedbackState): void {
    const newest = state.entries[0];
    if (!newest) return;
    if (newest.scope !== 'chat') return;
    if (newest.kind !== 'blocked' && newest.kind !== 'retryable') return;
    if (this.entry?.id === newest.id) return;
    this.show(newest);
  }

  private show(entry: FeedbackEntry): void {
    this.elementEl?.remove();
    this.entry = entry;

    const row = this.containerEl.createDiv({
      cls: `claudian-plus-turn-error claudian-plus-turn-error--${entry.level}`,
      attr: { role: 'status', 'data-feedback-id': entry.id },
    });
    this.elementEl = row;

    const head = row.createDiv({ cls: 'claudian-plus-turn-error-head' });
    head.createSpan({ cls: 'claudian-plus-turn-error-title', text: entry.title });

    if (entry.count > 1) {
      head.createSpan({
        cls: 'claudian-plus-turn-error-count',
        text: t('feedback.count', { count: entry.count }),
      });
    }

    const dismiss = head.createEl('button', {
      cls: 'claudian-plus-turn-error-dismiss',
      attr: { type: 'button', 'aria-label': t('feedback.dismiss') },
    });
    dismiss.addEventListener('click', () => this.clear());

    if (entry.detail) {
      row.createDiv({ cls: 'claudian-plus-turn-error-detail', text: entry.detail });
    }

    if (entry.actions?.length) {
      const actions = row.createDiv({ cls: 'claudian-plus-turn-error-actions' });
      for (const action of entry.actions) {
        const button = actions.createEl('button', {
          cls: 'claudian-plus-feedback-action',
          text: action.label,
          attr: { type: 'button', 'data-feedback-action': action.id },
        });
        button.addEventListener('click', () => {
          try {
            const result = action.run();
            if (result instanceof Promise) void result.catch(() => undefined);
          } catch {
            // A failing action must not spawn another failure report.
          }
        });
      }
    }
  }
}
