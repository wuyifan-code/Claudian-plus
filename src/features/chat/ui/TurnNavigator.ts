import { localeText } from '../../../i18n/i18n';
import {
  buildTurnNavigatorItems,
  resolveActiveItemIndex,
  resolveBarVisualState,
  type TurnNavigatorItem,
  type TurnNavigatorPosition,
} from './turnNavigator/model';

const ITEM_HEIGHT_PX = 10;
const OVERSCAN_ITEMS = 6;
const REFRESH_DELAY_MS = 80;
const STREAMING_REFRESH_DELAY_MS = 300;
/**
 * ZCode gates the navigator at 864px because its conversation pane is wide.
 * The Obsidian sidebar is far narrower, so the host threshold is scaled down.
 */
export const TURN_NAVIGATOR_MIN_WIDTH_PX = 280;

interface QueryRecord {
  key: string;
  messageEl: HTMLElement;
  userText: string;
  assistantText: string;
}

export interface TurnNavigatorOptions {
  side?: 'left' | 'right';
  isStreaming?: () => boolean;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function collectQueryRecords(messagesEl: HTMLElement): QueryRecord[] {
  const records: QueryRecord[] = [];
  const nodes = messagesEl.querySelectorAll<HTMLElement>('[data-message-id][data-role]');
  let pending: QueryRecord | null = null;

  for (const node of Array.from(nodes)) {
    const role = node.getAttribute('data-role');
    if (role === 'user') {
      if (pending) {
        records.push(pending);
      }
      pending = {
        key: node.getAttribute('data-message-id') ?? `user-${records.length}`,
        messageEl: node,
        userText: node.querySelector('.claudian-plus-message-content')?.textContent ?? node.textContent ?? '',
        assistantText: '',
      };
      continue;
    }

    if (role === 'assistant' && pending && !pending.assistantText) {
      const blocks = node.querySelectorAll('.claudian-plus-text-block');
      const parts: string[] = [];
      for (const block of Array.from(blocks)) {
        const text = normalizeText(block.textContent ?? '');
        if (text) parts.push(text);
      }
      pending.assistantText = parts.join(' ');
    }
  }

  if (pending) {
    records.push(pending);
  }
  return records;
}

/**
 * Conversation outline rail, ported from ZCode's ConversationTurnNavigator:
 * one tick per user query, virtualized, with a hover peak and a preview card.
 */
export class TurnNavigator {
  private container: HTMLElement;
  private railEl: HTMLElement;
  private spacerEl: HTMLElement;
  private previewEl: HTMLElement;
  private previewTitleEl: HTMLElement;
  private previewBodyEl: HTMLElement;

  private items: TurnNavigatorItem[] = [];
  private positions: TurnNavigatorPosition[] = [];
  private targets: HTMLElement[] = [];
  private markers = new Map<number, HTMLElement>();

  private activeIndex: number | undefined;
  private focusIndex: number | undefined;
  private side: 'left' | 'right';
  private isStreaming: () => boolean;
  private refreshTimer: number | null = null;
  private scrollFrame: number | null = null;
  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  constructor(
    private parentEl: HTMLElement,
    private messagesEl: HTMLElement,
    options: TurnNavigatorOptions = {},
  ) {
    this.side = options.side ?? 'left';
    this.isStreaming = options.isStreaming ?? (() => false);

    this.container = parentEl.createDiv({ cls: 'claudian-plus-turn-nav' });
    this.container.setAttribute('role', 'navigation');
    this.container.setAttribute('aria-label', localeText('对话导航', 'Conversation navigation'));

    this.railEl = this.container.createDiv({ cls: 'claudian-plus-turn-nav-rail' });
    this.spacerEl = this.railEl.createDiv({ cls: 'claudian-plus-turn-nav-spacer' });

    const bubbleHost = this.messagesEl.ownerDocument.body ?? this.parentEl;
    this.previewEl = bubbleHost.createDiv({ cls: 'claudian-plus-turn-nav-preview' });
    this.previewEl.setAttribute('role', 'tooltip');
    this.previewTitleEl = this.previewEl.createDiv({ cls: 'claudian-plus-turn-nav-preview-title' });
    this.previewBodyEl = this.previewEl.createDiv({ cls: 'claudian-plus-turn-nav-preview-body' });

    this.applySide();
    this.setupListeners();
    this.refresh();
  }

  setSide(side: 'left' | 'right'): void {
    if (this.side === side) return;
    this.side = side;
    this.applySide();
  }

  /** Kept for host parity; the outline reads the same in reading mode. */
  setReadingModeActive(_active: boolean): void {}

  /** Clears hover state when the tab is deactivated. */
  collapse(): void {
    this.setFocus(undefined);
  }

  updateVisibility(): void {
    this.applyVisibility();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    if (this.scrollFrame !== null) window.cancelAnimationFrame(this.scrollFrame);
    this.mutationObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.messagesEl.removeEventListener('scroll', this.handleScroll);
    this.parentEl.classList.remove('claudian-plus-has-nav-sidebar');
    this.parentEl.classList.remove('claudian-plus-nav-outline-right');
    this.previewEl.remove();
    this.container.remove();
  }

  private applySide(): void {
    this.container.classList.toggle('claudian-plus-turn-nav-right', this.side === 'right');
    this.parentEl.classList.toggle('claudian-plus-nav-outline-right', this.side === 'right');
  }

  private setupListeners(): void {
    this.messagesEl.addEventListener('scroll', this.handleScroll, { passive: true });

    if (typeof MutationObserver === 'function') {
      this.mutationObserver = new MutationObserver(() => this.scheduleRefresh());
      this.mutationObserver.observe(this.messagesEl, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        this.applyVisibility();
        this.scheduleRefresh();
      });
      this.resizeObserver.observe(this.messagesEl);
    }

    this.railEl.addEventListener('pointerleave', () => this.setFocus(undefined));
    this.railEl.addEventListener('scroll', () => this.setFocus(undefined));
  }

  private scheduleRefresh(): void {
    if (this.destroyed || this.refreshTimer !== null) return;
    // Streaming mutates the transcript continuously; measuring every 80ms would
    // force a layout per delta, so the rail settles at a slower cadence.
    const delay = this.isStreaming() ? STREAMING_REFRESH_DELAY_MS : REFRESH_DELAY_MS;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (!this.destroyed) this.refresh();
    }, delay);
  }

  private refresh(): void {
    const records = collectQueryRecords(this.messagesEl);
    const streaming = this.isStreaming();

    const inputs = records.map((record, index) => ({
      key: record.key,
      userText: record.userText,
      assistantText: record.assistantText,
      isRunning: streaming && index === records.length - 1,
    }));

    this.items = buildTurnNavigatorItems(inputs, {
      assistantEmptyPreview: localeText('没有回复', 'No reply'),
      assistantRunningPreview: localeText('回复中…', 'Replying...'),
      userFallbackPreview: localeText('未命名提问', 'Untitled query'),
    });
    this.targets = records.map((record) => record.messageEl);
    // Measuring every message forces a layout pass. While a reply streams only
    // the last message can change height, so re-read just that one.
    if (this.positions.length !== this.targets.length) {
      this.positions = this.measurePositions();
    } else if (streaming) {
      this.positions[this.positions.length - 1] = this.measurePosition(
        this.targets[this.targets.length - 1],
      );
    }
    this.activeIndex = resolveActiveItemIndex(
      this.positions,
      this.messagesEl.scrollTop,
      this.messagesEl.clientHeight,
    );

    this.spacerEl.setCssProps({ height: `${this.items.length * ITEM_HEIGHT_PX}px` });
    this.applyVisibility();
    this.reconcileMarkers();
    this.paintMarkers();
    this.scrollActiveIntoRail();
  }

  private measurePositions(): TurnNavigatorPosition[] {
    return this.targets.map((target) => this.measurePosition(target));
  }

  private measurePosition(target: HTMLElement): TurnNavigatorPosition {
    const hostTop = this.messagesEl.getBoundingClientRect().top;
    const scrollTop = this.messagesEl.scrollTop;
    const rect = target.getBoundingClientRect();
    const start = Math.max(0, rect.top - hostTop + scrollTop);
    return { start, end: start + Math.max(1, rect.height) };
  }

  private applyVisibility(): void {
    const count = this.items.length;
    const wide = this.messagesEl.clientWidth >= TURN_NAVIGATOR_MIN_WIDTH_PX;
    const shouldShow = count >= 2 && wide;
    this.container.classList.toggle('claudian-plus-turn-nav-hidden', !shouldShow);
    // Reserve a gutter so the rail never overlaps the transcript text.
    this.parentEl.classList.toggle('claudian-plus-has-nav-sidebar', shouldShow);
  }

  private visibleRange(): { from: number; to: number } {
    const count = this.items.length;
    const railHeight = this.railEl.clientHeight || 0;
    const top = this.railEl.scrollTop;
    const from = Math.max(0, Math.floor(top / ITEM_HEIGHT_PX) - OVERSCAN_ITEMS);
    const to = Math.min(
      count,
      Math.ceil((top + railHeight) / ITEM_HEIGHT_PX) + OVERSCAN_ITEMS,
    );
    return { from, to };
  }

  private reconcileMarkers(): void {
    const { from, to } = this.visibleRange();

    for (const [index, marker] of Array.from(this.markers.entries())) {
      if (index < from || index >= to) {
        marker.remove();
        this.markers.delete(index);
      }
    }

    for (let index = from; index < to; index += 1) {
      if (this.markers.has(index)) continue;
      const marker = this.spacerEl.createDiv({ cls: 'claudian-plus-turn-nav-item' });
      marker.setCssProps({ transform: `translateY(${index * ITEM_HEIGHT_PX}px)` });

      // A real <button> inherits Obsidian's themed chrome (background, radius,
      // shadow), which wraps each tick in a capsule. The rest of the toolbar uses
      // div + role=button for the same reason.
      const button = marker.createDiv({
        cls: 'claudian-plus-turn-nav-hit',
        attr: { role: 'button', tabindex: '0' },
      });
      const bar = button.createDiv({ cls: 'claudian-plus-turn-nav-bar' });

      button.addEventListener('pointerenter', () => this.setFocus(index));
      button.addEventListener('focus', () => this.setFocus(index));
      button.addEventListener('blur', () => this.setFocus(undefined));
      button.addEventListener('click', () => this.jumpTo(index));
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.jumpTo(index);
      });

      marker.setAttribute('data-item-index', String(index));
      bar.setAttribute('data-bar', '');
      this.markers.set(index, marker);
    }
  }

  private paintMarkers(): void {
    for (const [index, marker] of this.markers) {
      const item = this.items[index];
      if (!item) continue;
      const state = resolveBarVisualState(index, this.focusIndex);
      const bar = marker.querySelector<HTMLElement>('.claudian-plus-turn-nav-bar');
      const button = marker.querySelector<HTMLElement>('.claudian-plus-turn-nav-hit');
      if (!bar || !button) continue;

      const isActive = index === this.activeIndex;
      bar.setCssProps({
        opacity: String(isActive && this.focusIndex === undefined ? 0.9 : state.opacity),
        transform: `scaleX(${state.scaleX})`,
      });
      bar.classList.toggle('is-focus', state.colorTone === 'focus');
      bar.classList.toggle('is-active', isActive);
      button.setAttribute('aria-label', `${index + 1}. ${item.userPreview}`);
      button.setAttribute('aria-current', isActive ? 'location' : 'false');
    }
  }

  private setFocus(index: number | undefined): void {
    if (this.focusIndex === index) return;
    this.focusIndex = index;
    this.paintMarkers();
    if (index === undefined) {
      this.previewEl.classList.remove('is-visible');
      return;
    }
    this.showPreview(index);
  }

  private showPreview(index: number): void {
    const item = this.items[index];
    const marker = this.markers.get(index);
    if (!item || !marker) return;

    this.previewTitleEl.setText(item.userPreview);
    this.previewBodyEl.setText(item.assistantPreview);
    this.previewEl.classList.toggle('is-empty', item.assistantPreviewKind !== 'text');
    this.previewEl.classList.add('is-visible');

    const rect = marker.getBoundingClientRect();
    const width = this.previewEl.offsetWidth || 300;
    const margin = 12;
    const left = this.side === 'right'
      ? rect.left - width - margin
      : rect.right + margin;
    const top = Math.max(8, Math.min(rect.top - 8, window.innerHeight - 160));
    this.previewEl.setCssProps({
      top: `${Math.round(top)}px`,
      left: `${Math.round(Math.max(margin, Math.min(left, window.innerWidth - width - margin)))}px`,
    });
  }

  private jumpTo(index: number): void {
    const target = this.targets[index];
    const position = this.positions[index];
    if (!target || !position) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    this.messagesEl.scrollTo({
      top: Math.max(0, position.start - 8),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }

  private scrollActiveIntoRail(): void {
    if (this.activeIndex === undefined) return;
    const railHeight = this.railEl.clientHeight;
    if (railHeight === 0) return;
    const desired = this.activeIndex * ITEM_HEIGHT_PX - railHeight / 2;
    const max = Math.max(0, this.items.length * ITEM_HEIGHT_PX - railHeight);
    this.railEl.scrollTop = Math.max(0, Math.min(desired, max));
  }

  private handleScroll = (): void => {
    if (this.scrollFrame !== null) return;
    this.scrollFrame = window.requestAnimationFrame(() => {
      this.scrollFrame = null;
      if (this.destroyed) return;
      this.activeIndex = resolveActiveItemIndex(
        this.positions,
        this.messagesEl.scrollTop,
        this.messagesEl.clientHeight,
      );
      this.setFocus(undefined);
      this.paintMarkers();
      this.scrollActiveIntoRail();
    });
  };
}
