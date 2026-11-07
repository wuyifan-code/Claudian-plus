import { setIcon } from 'obsidian';

import { t } from '../../i18n/i18n';
import type { FeedbackBus, FeedbackSink } from './FeedbackBus';
import {
  FEEDBACK_INFO_TIMEOUT_MS,
  FEEDBACK_TOAST_LIMIT,
  type FeedbackEntry,
  type FeedbackLevel,
  type FeedbackState,
} from './types';

type DrawerFilter = 'all' | 'error' | 'warning' | 'info';

export interface FeedbackHostOptions {
  bus: FeedbackBus;
  /** Must sit inside a positioned container; the stack anchors above it. */
  toastAnchor: HTMLElement;
  /** Overlay container for the activity drawer. */
  drawerAnchor: HTMLElement;
  onCopyDiagnostics?: () => void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatClock(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `success` is shown under the info filter: it has the same "no action needed" weight. */
function filterBucket(level: FeedbackLevel): Exclude<DrawerFilter, 'all'> {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  return 'info';
}

/**
 * Renders the feedback bus into the chat panel: a toast stack above the
 * composer, a full-height activity drawer, and two live regions for screen
 * readers.
 *
 * The host never moves focus on its own — toasts are ambient. The drawer is
 * opened deliberately, so focus moves into it and returns to its trigger on
 * close.
 */
export class FeedbackHost implements FeedbackSink {
  private readonly bus: FeedbackBus;
  private readonly toastAnchor: HTMLElement;
  private readonly drawerAnchor: HTMLElement;
  private readonly onCopyDiagnostics?: () => void;

  private layerEl: HTMLElement | null = null;
  private politeEl: HTMLElement | null = null;
  private assertiveEl: HTMLElement | null = null;
  private stackEl: HTMLElement | null = null;
  private drawerEl: HTMLElement | null = null;
  private drawerBodyEl: HTMLElement | null = null;
  private drawerCloseEl: HTMLButtonElement | null = null;

  private unregister: (() => void) | null = null;
  private state: FeedbackState = { entries: [], unread: 0 };
  private toastIds: string[] = [];
  private readonly timers = new Map<string, number>();
  private hovered = false;
  private filter: DrawerFilter = 'all';
  private lastAnnouncedId: string | null = null;
  private triggerEl: HTMLElement | null = null;

  constructor(options: FeedbackHostOptions) {
    this.bus = options.bus;
    this.toastAnchor = options.toastAnchor;
    this.drawerAnchor = options.drawerAnchor;
    this.onCopyDiagnostics = options.onCopyDiagnostics;
  }

  /** Remember who opened the drawer so focus can go back there on close. */
  setTrigger(el: HTMLElement | null): void {
    this.triggerEl = el;
  }

  mount(): void {
    if (this.layerEl) return;

    const layer = this.toastAnchor.createDiv({ cls: 'claudian-plus-feedback-layer' });
    this.layerEl = layer;

    this.politeEl = layer.createDiv({
      cls: 'claudian-plus-feedback-sr',
      attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    });
    this.assertiveEl = layer.createDiv({
      cls: 'claudian-plus-feedback-sr',
      attr: { role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true' },
    });
    this.stackEl = layer.createDiv({ cls: 'claudian-plus-feedback-stack' });

    // Hovering the panel must not make a toast vanish under the pointer.
    layer.addEventListener('mouseenter', () => {
      this.hovered = true;
      this.clearTimers();
    });
    layer.addEventListener('mouseleave', () => {
      this.hovered = false;
      this.armTimers(this.syncVisibleToasts(this.state));
    });

    this.unregister = this.bus.registerSink(this);
  }

  unmount(): void {
    this.unregister?.();
    this.unregister = null;

    this.clearTimers();

    this.closeDrawer();
    this.layerEl?.remove();
    this.layerEl = null;
    this.politeEl = null;
    this.assertiveEl = null;
    this.stackEl = null;
    this.state = { entries: [], unread: 0 };
    this.toastIds = [];
  }

  isMounted(): boolean {
    return this.layerEl !== null;
  }

  isDrawerOpen(): boolean {
    return this.drawerEl !== null;
  }

  render(state: FeedbackState): void {
    if (!this.layerEl || !this.stackEl) return;

    this.state = state;
    const visible = this.syncVisibleToasts(state);
    this.renderToasts(visible);
    this.armTimers(visible);
    this.announce(state);
    if (this.drawerEl) this.renderDrawer();
  }

  openLog(): void {
    if (!this.layerEl) return;
    if (!this.drawerEl) {
      this.buildDrawer();
    }
    this.renderDrawer();
    this.drawerCloseEl?.focus();
  }

  closeDrawer(): void {
    if (!this.drawerEl) return;
    this.drawerEl.remove();
    this.drawerEl = null;
    this.drawerBodyEl = null;
    this.drawerCloseEl = null;
    this.triggerEl?.focus();
  }

  private syncVisibleToasts(state: FeedbackState): FeedbackEntry[] {
    const byId = new Map(state.entries.map(entry => [entry.id, entry]));
    this.toastIds = this.toastIds.filter(id => byId.has(id));

    const known = new Set(this.toastIds);
    // `state.entries` is newest-first; walk it backwards so the stack keeps
    // chronological order (oldest on top, newest closest to the composer).
    for (let index = state.entries.length - 1; index >= 0; index -= 1) {
      const entry = state.entries[index];
      if (!known.has(entry.id)) {
        this.toastIds.push(entry.id);
        known.add(entry.id);
      }
    }

    if (this.toastIds.length > FEEDBACK_TOAST_LIMIT) {
      this.toastIds = this.toastIds.slice(this.toastIds.length - FEEDBACK_TOAST_LIMIT);
    }

    return this.toastIds
      .map(id => byId.get(id))
      .filter((entry): entry is FeedbackEntry => entry !== undefined);
  }

  private renderToasts(visible: FeedbackEntry[]): void {
    if (!this.stackEl) return;
    this.stackEl.empty();
    for (const entry of visible) {
      this.buildToast(this.stackEl, entry);
    }
    this.stackEl.toggleClass('claudian-plus-hidden', visible.length === 0);
  }

  private buildToast(parent: HTMLElement, entry: FeedbackEntry): void {
    const toast = parent.createDiv({
      cls: [
        'claudian-plus-feedback-toast',
        `claudian-plus-feedback-toast--${entry.level}`,
        entry.actions?.length ? 'claudian-plus-feedback-toast--persistent' : '',
      ].filter(Boolean).join(' '),
      attr: { 'data-feedback-id': entry.id, 'data-feedback-kind': entry.kind },
    });

    const head = toast.createDiv({ cls: 'claudian-plus-feedback-toast-head' });
    head.createSpan({ cls: 'claudian-plus-feedback-toast-title', text: entry.title });

    if (entry.count > 1) {
      head.createSpan({
        cls: 'claudian-plus-feedback-toast-count',
        text: t('feedback.count', { count: entry.count }),
      });
    }

    const close = head.createEl('button', {
      cls: 'claudian-plus-feedback-toast-close',
      attr: { type: 'button', 'aria-label': t('feedback.dismiss') },
    });
    setIcon(close, 'x');
    close.addEventListener('click', () => {
      this.hideToast(entry.id);
    });

    if (entry.detail) {
      toast.createDiv({ cls: 'claudian-plus-feedback-toast-detail', text: entry.detail });
    }

    this.appendActions(toast, entry, 'claudian-plus-feedback-toast-actions');
  }

  private appendActions(parent: HTMLElement, entry: FeedbackEntry, cls: string): void {
    if (!entry.actions?.length) return;
    const row = parent.createDiv({ cls });
    for (const action of entry.actions) {
      const button = row.createEl('button', {
        cls: 'claudian-plus-feedback-action',
        text: action.label,
        attr: { type: 'button', 'data-feedback-action': action.id },
      });
      button.addEventListener('click', () => {
        void this.runAction(action.run);
      });
    }
  }

  private async runAction(run: () => void | Promise<void>): Promise<void> {
    try {
      await run();
    } catch {
      // A failing action must not produce another entry: that would let a
      // broken retry loop flood the buffer.
    }
  }

  private isAutoDismissable(entry: FeedbackEntry): boolean {
    if (entry.actions?.length) return false;
    return entry.level === 'info' || entry.level === 'success';
  }

  /** Timers follow the host's own window so Hover Editor popouts keep working. */
  private timerWindow(): Window {
    const view = this.layerEl?.ownerDocument?.defaultView;
    return (view ?? window);
  }

  private clearTimers(): void {
    const win = this.timerWindow();
    for (const handle of this.timers.values()) {
      win.clearTimeout(handle);
    }
    this.timers.clear();
  }

  private armTimers(visible: FeedbackEntry[]): void {
    const win = this.timerWindow();
    const visibleIds = new Set(visible.map(entry => entry.id));
    for (const [id, handle] of [...this.timers.entries()]) {
      if (!visibleIds.has(id)) {
        win.clearTimeout(handle);
        this.timers.delete(id);
      }
    }

    if (this.hovered) return;

    for (const entry of visible) {
      if (!this.isAutoDismissable(entry) || this.timers.has(entry.id)) continue;
      const handle = win.setTimeout(() => {
        this.timers.delete(entry.id);
        this.hideToast(entry.id);
      }, FEEDBACK_INFO_TIMEOUT_MS);
      this.timers.set(entry.id, handle);
    }
  }

  private hideToast(id: string): void {
    const handle = this.timers.get(id);
    if (handle) {
      this.timerWindow().clearTimeout(handle);
      this.timers.delete(id);
    }
    this.toastIds = this.toastIds.filter(toastId => toastId !== id);
    const visible = this.toastIds
      .map(toastId => this.state.entries.find(entry => entry.id === toastId))
      .filter((entry): entry is FeedbackEntry => entry !== undefined);
    this.renderToasts(visible);
  }

  private announce(state: FeedbackState): void {
    const newest = state.entries[0];
    if (!newest || newest.id === this.lastAnnouncedId) return;
    this.lastAnnouncedId = newest.id;

    const target = newest.level === 'error' || newest.level === 'warning'
      ? this.assertiveEl
      : this.politeEl;
    if (!target) return;
    target.setText(newest.count > 1
      ? `${newest.title} ${t('feedback.count', { count: newest.count })}`
      : newest.title);
  }

  private buildDrawer(): void {
    const drawer = this.drawerAnchor.createDiv({
      cls: 'claudian-plus-feedback-drawer',
      attr: { role: 'dialog', 'aria-label': t('feedback.drawerTitle') },
    });
    this.drawerEl = drawer;

    const header = drawer.createDiv({ cls: 'claudian-plus-feedback-drawer-header' });
    header.createSpan({ cls: 'claudian-plus-feedback-drawer-title', text: t('feedback.drawerTitle') });

    const filters = header.createDiv({ cls: 'claudian-plus-feedback-drawer-filters' });
    for (const value of ['all', 'error', 'warning', 'info'] as const) {
      const button = filters.createEl('button', {
        cls: `claudian-plus-feedback-filter${this.filter === value ? ' is-active' : ''}`,
        text: this.filterLabel(value),
        attr: { type: 'button', 'data-feedback-filter': value },
      });
      button.addEventListener('click', () => {
        this.filter = value;
        this.renderDrawer();
      });
    }

    const copy = header.createEl('button', {
      cls: 'claudian-plus-feedback-drawer-copy',
      text: t('feedback.actionCopyDiagnostics'),
      attr: { type: 'button' },
    });
    copy.addEventListener('click', () => {
      this.onCopyDiagnostics?.();
    });

    const clear = header.createEl('button', {
      cls: 'claudian-plus-feedback-drawer-clear',
      text: t('feedback.clear'),
      attr: { type: 'button' },
    });
    clear.addEventListener('click', () => {
      this.bus.clear();
    });

    const close = header.createEl('button', {
      cls: 'claudian-plus-feedback-drawer-close',
      attr: { type: 'button', 'aria-label': t('feedback.dismiss') },
    });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.closeDrawer());
    this.drawerCloseEl = close;

    this.drawerBodyEl = drawer.createDiv({ cls: 'claudian-plus-feedback-drawer-body' });

    drawer.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeDrawer();
      }
    });
  }

  private filterLabel(value: DrawerFilter): string {
    switch (value) {
      case 'error':
        return t('feedback.filterError');
      case 'warning':
        return t('feedback.filterWarning');
      case 'info':
        return t('feedback.filterInfo');
      default:
        return t('feedback.filterAll');
    }
  }

  private renderDrawer(): void {
    if (!this.drawerEl || !this.drawerBodyEl) return;

    for (const button of Array.from(this.drawerEl.querySelectorAll<HTMLElement>('.claudian-plus-feedback-filter'))) {
      button.toggleClass('is-active', button.dataset.feedbackFilter === this.filter);
    }

    const body = this.drawerBodyEl;
    body.empty();

    const entries = this.filter === 'all'
      ? this.state.entries
      : this.state.entries.filter(entry => filterBucket(entry.level) === this.filter);

    if (entries.length === 0) {
      body.createDiv({ cls: 'claudian-plus-feedback-empty', text: t('feedback.drawerEmpty') });
      return;
    }

    for (const entry of entries) {
      const row = body.createDiv({
        cls: 'claudian-plus-feedback-entry',
        attr: { 'data-feedback-id': entry.id },
      });

      const head = row.createDiv({ cls: 'claudian-plus-feedback-entry-head' });
      head.createSpan({
        cls: `claudian-plus-feedback-entry-level claudian-plus-feedback-entry-level--${entry.level}`,
        text: this.levelLabel(entry.level),
      });
      head.createSpan({ cls: 'claudian-plus-feedback-entry-title', text: entry.title });
      if (entry.count > 1) {
        head.createSpan({
          cls: 'claudian-plus-feedback-entry-count',
          text: t('feedback.count', { count: entry.count }),
        });
      }
      head.createSpan({ cls: 'claudian-plus-feedback-entry-time', text: formatClock(entry.at) });

      if (entry.detail) {
        row.createDiv({ cls: 'claudian-plus-feedback-entry-detail', text: entry.detail });
      }

      this.appendActions(row, entry, 'claudian-plus-feedback-entry-actions');
    }
  }

  private levelLabel(level: FeedbackLevel): string {
    switch (level) {
      case 'error':
        return t('feedback.filterError');
      case 'warning':
        return t('feedback.filterWarning');
      case 'success':
        return t('common.success');
      default:
        return t('feedback.filterInfo');
    }
  }
}
