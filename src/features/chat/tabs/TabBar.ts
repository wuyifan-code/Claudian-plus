import { Menu, setIcon } from 'obsidian';

import { scheduleAnimationFrame } from '../../../utils/animationFrame';
import type { TabBarItem, TabId } from './types';

const EXPANDED_TITLE_MAX_LENGTH = 32;
const TRUNCATED_TITLE_SUFFIX = '...';

/** Callbacks for TabBar interactions. */
export interface TabBarCallbacks {
  /** Called when a tab badge is clicked. */
  onTabClick: (tabId: TabId) => void;

  /** Called when the close button is clicked on a tab. */
  onTabClose: (tabId: TabId) => void;

  /** Called when the new tab button is clicked. */
  onNewTab: () => void;

  /** Called when a tab is moved to a new index via drag and drop. */
  onTabReorder?: (tabId: TabId, toIndex: number) => void;

  /** Called when badge title expansion state changes. */
  onTitleExpansionChanged?: (expandedTitleTabIds: TabId[]) => void;
}

interface DragState {
  sourceTabId: TabId;
  badgeEl: HTMLElement;
  startX: number;
  startY: number;
  isDragging: boolean;
  targetIndex: number;
}

/**
 * TabBar renders minimal numbered badge navigation with drag reorder,
 * middle-click close, and overflow dropdown.
 */
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  private expandedTitleTabIds = new Set<TabId>();
  private lastKnownScrollLeft = 0;
  private currentItems: TabBarItem[] = [];
  private readonly handleScroll = (): void => {
    this.captureScrollPosition();
  };

  constructor(containerEl: HTMLElement, callbacks: TabBarCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.build();
  }

  /** Builds the tab bar UI. */
  private build(): void {
    this.containerEl.addClass('claudian-plus-tab-badges');
    this.containerEl.addEventListener('scroll', this.handleScroll);
  }

  /**
   * Updates the tab bar with new tab data.
   * @param items Tab items to render.
   */
  update(items: TabBarItem[]): void {
    this.currentItems = items;
    this.captureStableScrollPosition();
    this.pruneExpandedTitleState(items);

    // Clear existing badges
    this.containerEl.empty();

    // Render badges
    for (const item of items) {
      this.renderBadge(item);
    }

    this.renderOverflowButtonIfNeeded(items);
    this.restoreScrollPosition();
  }

  getExpandedTitleTabIds(): TabId[] {
    return Array.from(this.expandedTitleTabIds);
  }

  setExpandedTitleTabIds(tabIds: readonly TabId[]): void {
    this.expandedTitleTabIds = new Set(tabIds);
  }

  /** Renders a single tab badge. */
  private renderBadge(item: TabBarItem): void {
    // Determine state class (priority: active > attention > streaming > idle)
    let stateClass = 'claudian-plus-tab-badge-idle';
    if (item.isActive) {
      stateClass = 'claudian-plus-tab-badge-active';
    } else if (item.needsAttention) {
      stateClass = 'claudian-plus-tab-badge-attention';
    } else if (item.isStreaming) {
      stateClass = 'claudian-plus-tab-badge-streaming';
    }

    const isTitleExpanded = this.expandedTitleTabIds.has(item.id);
    const badgeEl = this.containerEl.createDiv({
      cls: [
        'claudian-plus-tab-badge',
        stateClass,
        isTitleExpanded ? 'claudian-plus-tab-badge-expanded' : '',
      ].filter(Boolean).join(' '),
      text: this.getBadgeLabel(item),
    });

    // Obsidian uses aria-label for hover tooltips here; adding title causes duplicate tooltip text.
    badgeEl.setAttribute('aria-label', item.title);
    badgeEl.setAttribute('data-provider', item.providerId);
    badgeEl.setAttribute('data-title-expanded', isTitleExpanded ? 'true' : 'false');
    badgeEl.setAttribute('data-tab-id', item.id);

    // Click handler to switch tab
    badgeEl.addEventListener('click', (e?: MouseEvent) => {
      if (!e || e.button === 0 || e.button === undefined) {
        this.captureScrollPosition();
        this.callbacks.onTabClick(item.id);
      }
    });

    // Middle-click to close (if allowed)
    badgeEl.addEventListener('auxclick', (e: MouseEvent) => {
      if (e.button === 1 && item.canClose) {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onTabClose(item.id);
      }
    });

    badgeEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleBadgeTitle(item, badgeEl);
    });

    // Right-click to close (if allowed)
    if (item.canClose) {
      badgeEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.callbacks.onTabClose(item.id);
      });
    }

    // Pointer events for drag-to-reorder
    let dragState: DragState | null = null;

    badgeEl.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragState = {
        sourceTabId: item.id,
        badgeEl,
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
        targetIndex: item.index - 1,
      };
      if (typeof badgeEl.setPointerCapture === 'function') {
        try {
          badgeEl.setPointerCapture(e.pointerId);
        } catch {
          // Ignore if pointer capture fails in test environment
        }
      }
    });

    badgeEl.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragState) return;
      if (!dragState.isDragging) {
        const dist = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);
        if (dist > 6) {
          dragState.isDragging = true;
          badgeEl.addClass('claudian-plus-tab-badge--dragging');
        }
      }

      if (dragState.isDragging) {
        const allBadges = Array.from(
          this.containerEl.querySelectorAll('.claudian-plus-tab-badge')
        );
        let targetIndex = allBadges.indexOf(badgeEl);

        for (let i = 0; i < allBadges.length; i++) {
          const b = allBadges[i];
          b.removeClass('claudian-plus-tab-badge--drop-target');
          const rect = b.getBoundingClientRect?.() ?? { left: i * 28, right: (i + 1) * 28, width: 24 };
          const rightEdge = rect.right || (rect.left + (rect.width || 24));
          if (e.clientX >= rect.left && e.clientX <= rightEdge) {
            targetIndex = i;
            b.addClass('claudian-plus-tab-badge--drop-target');
          }
        }
        dragState.targetIndex = targetIndex;
      }
    });

    badgeEl.addEventListener('pointerup', (e: PointerEvent) => {
      if (!dragState) return;
      const wasDragging = dragState.isDragging;
      const targetIndex = dragState.targetIndex;
      const sourceId = dragState.sourceTabId;

      badgeEl.removeClass('claudian-plus-tab-badge--dragging');
      const allBadges = this.containerEl.querySelectorAll('.claudian-plus-tab-badge');
      allBadges.forEach(b => b.removeClass('claudian-plus-tab-badge--drop-target'));

      if (typeof badgeEl.releasePointerCapture === 'function') {
        try {
          badgeEl.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore in test environment
        }
      }

      dragState = null;

      if (wasDragging) {
        this.callbacks.onTabReorder?.(sourceId, targetIndex);
      }
    });
  }

  private renderOverflowButtonIfNeeded(items: TabBarItem[]): void {
    const isOverflowing = this.containerEl.scrollWidth > this.containerEl.clientWidth || items.length > 5;
    if (!isOverflowing || items.length <= 1) return;

    const overflowBtn = this.containerEl.createDiv({
      cls: 'claudian-plus-tab-overflow-btn',
    });
    overflowBtn.setAttribute('role', 'button');
    overflowBtn.setAttribute('tabindex', '0');
    overflowBtn.setAttribute('aria-label', 'All tabs');
    setIcon(overflowBtn, 'chevron-down');

    overflowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = new Menu();
      for (const item of items) {
        menu.addItem((menuItem) => {
          menuItem
            .setTitle(`#${item.index} ${item.title}`)
            .setChecked(item.isActive)
            .onClick(() => {
              this.callbacks.onTabClick(item.id);
            });
        });
      }
      menu.showAtMouseEvent(e);
    });
  }

  /** Destroys the tab bar. */
  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-plus-tab-badges');
    this.containerEl.removeEventListener('scroll', this.handleScroll);
    this.expandedTitleTabIds.clear();
    this.lastKnownScrollLeft = 0;
    this.currentItems = [];
  }

  captureScrollPosition(): void {
    this.lastKnownScrollLeft = this.containerEl.scrollLeft;
  }

  restoreScrollPosition(): void {
    const scrollLeft = this.lastKnownScrollLeft;
    this.containerEl.scrollLeft = scrollLeft;
    if (scrollLeft <= 0) return;

    scheduleAnimationFrame(() => {
      if (this.containerEl.scrollLeft !== 0) return;
      this.containerEl.scrollLeft = scrollLeft;
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  private captureStableScrollPosition(): void {
    const currentScrollLeft = this.containerEl.scrollLeft;
    if (currentScrollLeft > 0 || this.lastKnownScrollLeft === 0) {
      this.lastKnownScrollLeft = currentScrollLeft;
    }
  }

  private pruneExpandedTitleState(items: TabBarItem[]): void {
    const visibleTabIds = new Set(items.map(item => item.id));
    for (const tabId of this.expandedTitleTabIds) {
      if (!visibleTabIds.has(tabId)) {
        this.expandedTitleTabIds.delete(tabId);
      }
    }
  }

  private toggleBadgeTitle(item: TabBarItem, badgeEl: HTMLElement): void {
    if (this.expandedTitleTabIds.has(item.id)) {
      this.expandedTitleTabIds.delete(item.id);
    } else {
      this.expandedTitleTabIds.add(item.id);
    }

    const isTitleExpanded = this.expandedTitleTabIds.has(item.id);
    badgeEl.textContent = this.getBadgeLabel(item);
    badgeEl.toggleClass('claudian-plus-tab-badge-expanded', isTitleExpanded);
    badgeEl.setAttribute('data-title-expanded', isTitleExpanded ? 'true' : 'false');
    this.callbacks.onTitleExpansionChanged?.(this.getExpandedTitleTabIds());
  }

  private getBadgeLabel(item: TabBarItem): string {
    if (!this.expandedTitleTabIds.has(item.id)) {
      return String(item.index);
    }

    return this.truncateExpandedTitle(item.title);
  }

  private truncateExpandedTitle(title: string): string {
    const chars = Array.from(title);
    if (chars.length <= EXPANDED_TITLE_MAX_LENGTH) {
      return title;
    }

    return `${chars.slice(0, EXPANDED_TITLE_MAX_LENGTH - TRUNCATED_TITLE_SUFFIX.length).join('')}${TRUNCATED_TITLE_SUFFIX}`;
  }
}
