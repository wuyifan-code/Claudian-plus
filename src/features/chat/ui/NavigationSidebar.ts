import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import {
  type ConversationOutlineEntry,
  type ConversationOutlineKind,
  type ConversationOutlineLevel,
  extractOutlineEntries,
  filterEntriesByKinds,
} from './outlineExtraction';

export type { ConversationOutlineEntry, ConversationOutlineKind, ConversationOutlineLevel };

const OUTLINE_REFRESH_DELAY_MS = 80;
// Wave TOC peaks at 51px: the hovered H1 grows from 27px to 51px and the
// gaussian ripple sweeps the neighboring ticks. The transcript gutter is
// sized to keep the peak clear of the text (see messages.css).
const WAVE_PEAK_WIDTH = 51;
const WAVE_SIGMA = 1.55;
let nextOutlinePreviewId = 0;

/**
 * Floating conversation outline rail.
 * Renders filter chips and a track of horizontal tick markers sized to the transcript height.
 */
export class NavigationSidebar {
  private container: HTMLElement;
  private outlineTrack: HTMLElement;
  private outlineEntries: ConversationOutlineEntry[] = [];
  private outlineMarkers: HTMLElement[] = [];
  private activeOutlineIndex: number | null = null;
  private hoverIndex = -1;
  private outlinePreview: HTMLElement | null = null;
  private outlinePreviewTitleEl: HTMLElement | null = null;
  private outlinePreviewExcerptEl: HTMLElement | null = null;
  private outlinePreviewBadgeEl: HTMLElement | null = null;
  private outlinePreviewTrigger: HTMLElement | null = null;
  private scrollHandler: () => void = () => {};
  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pendingVisibilityFrame: ScheduledAnimationFrame | null = null;
  private pendingOutlineReposition = false;
  private pendingOutlineRefresh: { id: number; ownerWindow: Window } | null = null;
  private isVisible: boolean | null = null;
  private destroyed = false;
  private side: 'left' | 'right';
  private waveFrame: number | null = null;
  private wavePosition = 0;
  private waveVelocity = 0;
  private waveAmplitude = 0;
  private waveTarget = 0;
  private waveActive = false;
  private isReadingModeActive = false;

  constructor(
    private parentEl: HTMLElement,
    private messagesEl: HTMLElement,
    side: 'left' | 'right' = 'left',
  ) {
    this.side = side;
    this.container = this.parentEl.createDiv({ cls: 'claudian-plus-nav-sidebar' });
    this.container.setAttribute('aria-label', 'Conversation outline sidebar');
    this.applySide();
    this.container.tabIndex = -1;

    // Outline track holds horizontal tick markers sized to the transcript height.
    this.outlineTrack = this.container.createDiv({ cls: 'claudian-plus-nav-outline-track' });
    this.outlineTrack.setAttribute('role', 'navigation');
    this.outlineTrack.setAttribute('aria-label', 'Conversation outline');

    const bubbleHost = this.messagesEl.ownerDocument.body ?? this.parentEl;
    this.outlinePreview = bubbleHost.createDiv({ cls: 'claudian-plus-nav-outline-preview' });
    this.outlinePreview.setAttribute('id', `claudian-plus-outline-preview-${++nextOutlinePreviewId}`);
    this.outlinePreview.setAttribute('role', 'tooltip');
    this.outlinePreviewTitleEl = this.outlinePreview.createDiv({ cls: 'claudian-plus-nav-outline-preview-title' });
    this.outlinePreviewExcerptEl = this.outlinePreview.createDiv({ cls: 'claudian-plus-nav-outline-preview-excerpt' });
    this.outlinePreviewBadgeEl = this.outlinePreview.createDiv({ cls: 'claudian-plus-nav-outline-preview-badge' });
    this.outlinePreviewBadgeEl.setAttribute('aria-hidden', 'true');

    this.setupEventListeners();
    this.refreshOutline();
    this.applyVisibility();
  }

  setReadingModeActive(active: boolean): void {
    if (this.isReadingModeActive === active) return;
    this.isReadingModeActive = active;
    this.refreshOutline();
  }

  getEffectiveEnabledKinds(): Set<ConversationOutlineKind> {
    return new Set<ConversationOutlineKind>(['prompt']);
  }

  setSide(side: 'left' | 'right'): void {
    if (this.side === side) return;
    this.side = side;
    this.applySide();
  }

  private applySide(): void {
    this.container.classList.toggle('claudian-plus-nav-outline-right', this.side === 'right');
    this.parentEl.classList.toggle('claudian-plus-nav-outline-right', this.side === 'right');
  }

  private setupEventListeners(): void {
    this.scrollHandler = () => this.updateVisibility();
    this.messagesEl.addEventListener('scroll', this.scrollHandler, { passive: true });

    this.container.addEventListener('keydown', (event: KeyboardEvent) => {
      if (this.outlineMarkers.length === 0) return;
      if (event.key === 'Home') {
        event.preventDefault();
        this.outlineMarkers[0]?.focus({ preventScroll: true });
      } else if (event.key === 'End') {
        event.preventDefault();
        this.outlineMarkers[this.outlineMarkers.length - 1]?.focus({ preventScroll: true });
      }
    });

    this.outlineTrack.addEventListener('mousemove', (event: MouseEvent) => {
      this.hoverOutlineAt(event.clientY);
    });
    this.outlineTrack.addEventListener('click', (event: MouseEvent) => {
      if (this.hoverIndex < 0 || this.destroyed) return;
      event.stopPropagation();
      const entry = this.outlineEntries[this.hoverIndex];
      if (entry) {
        this.scrollToElement(this.resolveEntryTarget(entry));
        this.hideOutlinePreview();
      }
    });
    this.outlineTrack.addEventListener('mouseleave', () => {
      this.releaseWaveFocus();
      this.deactivateOutlineEntry();
    });

    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver((mutations) => {
        this.scheduleOutlineRefresh(mutations);
      });
      this.mutationObserver.observe(this.messagesEl, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-toc-title', 'class'],
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleLayoutUpdate(true);
      });
      this.resizeObserver.observe(this.messagesEl);
    }
  }

  updateVisibility(): void {
    this.scheduleLayoutUpdate();
  }

  private scheduleLayoutUpdate(repositionOutlineMarkers = false): void {
    if (this.destroyed) return;
    this.pendingOutlineReposition ||= repositionOutlineMarkers;
    if (this.pendingVisibilityFrame !== null) return;
    this.pendingVisibilityFrame = scheduleAnimationFrame(() => {
      this.pendingVisibilityFrame = null;
      if (this.destroyed) return;
      if (this.pendingOutlineReposition) {
        this.pendingOutlineReposition = false;
        this.repositionOutlineMarkers();
      }
      this.applyVisibility();
      this.applyActiveOutline();
    }, this.messagesEl.ownerDocument.defaultView ?? null);
  }

  private applyVisibility(): void {
    const { scrollHeight, clientHeight } = this.messagesEl;
    const isScrollable = scrollHeight > clientHeight + 10;
    const hasOutline = this.outlineEntries.length > 0;
    const shouldShow = isScrollable && hasOutline;
    if (this.isVisible === shouldShow) return;
    this.isVisible = shouldShow;
    this.container.classList.toggle('visible', shouldShow);
    this.parentEl.classList.toggle('claudian-plus-has-nav-sidebar', shouldShow);
  }

  private scheduleOutlineRefresh(_mutations: MutationRecord[]): void {
    if (this.destroyed) return;
    if (this.pendingOutlineRefresh !== null) return;
    const ownerWindow = this.messagesEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      this.refreshOutline();
      return;
    }
    const id = ownerWindow.setTimeout(() => {
      this.pendingOutlineRefresh = null;
      if (this.destroyed) return;
      this.refreshOutline();
    }, OUTLINE_REFRESH_DELAY_MS);
    this.pendingOutlineRefresh = { id, ownerWindow };
  }

  private refreshOutline(): void {
    if (this.destroyed) return;
    const allEntries = extractOutlineEntries(this.messagesEl);
    const nextEntries = filterEntriesByKinds(allEntries, this.getEffectiveEnabledKinds());

    if (this.hasSameOutlineStructure(nextEntries)) {
      const previewMarkerIndex = this.outlinePreviewTrigger
        ? this.outlineMarkers.indexOf(this.outlinePreviewTrigger)
        : -1;
      nextEntries.forEach((entry, index) => {
        this.outlineEntries[index].targetEl = entry.targetEl;
        this.outlineEntries[index].messageEl = entry.messageEl;
        this.outlineEntries[index].excerpt = entry.excerpt;
      });
      if (previewMarkerIndex >= 0) {
        this.showOutlinePreview(
          this.outlineEntries[previewMarkerIndex],
          this.outlineMarkers[previewMarkerIndex],
        );
      }
      this.repositionOutlineMarkers();
      this.applyActiveOutline();
      this.applyVisibility();
      return;
    }

    const activeElement = this.parentEl.ownerDocument.activeElement as HTMLElement | null;
    const focusedMarkerIndex = activeElement
      ? this.outlineMarkers.indexOf(activeElement)
      : -1;
    this.deactivateOutlineEntry();
    this.outlineEntries = nextEntries;
    this.outlineMarkers = [];
    this.activeOutlineIndex = null;
    this.outlineTrack.empty();

    this.outlineEntries.forEach((entry, index) => {
      const marker = this.outlineTrack.createEl('button', {
        cls: 'claudian-plus-nav-outline-marker',
        attr: {
          type: 'button',
          'aria-label': entry.title,
          'data-outline-kind': entry.kind,
          'data-outline-level': String(entry.level),
        },
      });
      this.positionOutlineMarker(marker, index);
      this.outlineMarkers.push(marker);

      const selectEntry = (event?: Event): void => {
        event?.stopPropagation();
        this.scrollToElement(this.resolveEntryTarget(entry));
        this.hideOutlinePreview();
      };
      marker.addEventListener('click', selectEntry);
      marker.addEventListener('mouseenter', () => this.activateOutlineEntry(index));
      marker.addEventListener('focus', () => this.activateOutlineEntry(index));
      marker.addEventListener('blur', () => {
        if (this.hoverIndex === index) this.deactivateOutlineEntry();
      });
      marker.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.hideOutlinePreview();
          (marker as HTMLElement & { blur?: () => void }).blur?.();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          const nextIndex = Math.max(
            0,
            Math.min(
              this.outlineMarkers.length - 1,
              this.outlineMarkers.indexOf(marker) + direction,
            ),
          );
          const nextMarker = this.outlineMarkers[nextIndex];
          if (nextMarker && nextMarker !== marker) {
            nextMarker.focus({ preventScroll: true });
          }
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectEntry(event);
        }
      });
    });

    const ownerWindow = this.messagesEl.ownerDocument.defaultView;
    ownerWindow?.requestAnimationFrame(() => {
      if (this.destroyed || !this.outlineTrack) return;
      const available = Math.max(0, this.outlineTrack.clientHeight - 8);
      const count = this.outlineEntries.length;
      const gap = count > 1
        ? Math.min(15, Math.max(5, (available - count * 3) / (count - 1)))
        : 15;
      this.outlineTrack.style.setProperty('--cp-nav-tick-gap', `${gap}px`);
    });

    this.applyActiveOutline();
    if (focusedMarkerIndex >= 0) {
      const nextFocusTarget = this.outlineMarkers[
        Math.min(focusedMarkerIndex, this.outlineMarkers.length - 1)
      ];
      nextFocusTarget?.focus({ preventScroll: true });
    }
    this.applyVisibility();
  }

  private hasSameOutlineStructure(entries: ConversationOutlineEntry[]): boolean {
    return entries.length === this.outlineEntries.length
      && entries.every((entry, index) => {
        const current = this.outlineEntries[index];
        return entry.kind === current.kind
          && entry.level === current.level
          && entry.badge === current.badge
          && entry.title === current.title;
      });
  }

  private applyActiveOutline(): void {
    if (this.outlineMarkers.length === 0 || this.outlineEntries.length === 0) return;

    const readingLine = this.messagesEl.scrollTop + this.messagesEl.clientHeight * 0.25;
    const canUseRects = typeof this.messagesEl.getBoundingClientRect === 'function';
    const containerRect = canUseRects ? this.messagesEl.getBoundingClientRect() : null;
    let activeIndex = 0;
    let low = 0;
    let high = this.outlineEntries.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const middleTop = this.getElementTop(
        this.resolveEntryTarget(this.outlineEntries[middle]),
        containerRect,
      );
      if (middleTop <= readingLine) {
        activeIndex = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (this.activeOutlineIndex === activeIndex) {
      return;
    }

    if (this.activeOutlineIndex !== null) {
      const previousMarker = this.outlineMarkers[this.activeOutlineIndex];
      previousMarker?.classList.remove('is-active');
      previousMarker?.setAttribute('aria-current', 'false');
    }
    const activeMarker = this.outlineMarkers[activeIndex];
    activeMarker.classList.add('is-active');
    activeMarker.setAttribute('aria-current', 'location');
    this.activeOutlineIndex = activeIndex;
  }

  private positionOutlineMarker(_marker: HTMLElement, _index: number): void {
    // Markers laid out by track's flex gap
  }

  private repositionOutlineMarkers(): void {
    this.outlineMarkers.forEach((marker, index) => this.positionOutlineMarker(marker, index));
  }

  private hoverOutlineAt(clientY: number): void {
    if (this.destroyed || this.outlineMarkers.length === 0) return;
    let index = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.outlineMarkers.forEach((marker, markerIndex) => {
      const rect = marker.getBoundingClientRect();
      const distance = Math.abs(clientY - (rect.top + rect.height / 2));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        index = markerIndex;
      }
    });
    this.activateOutlineEntry(index);
  }

  private activateOutlineEntry(index: number): void {
    const marker = this.outlineMarkers[index];
    const entry = this.outlineEntries[index];
    if (!marker || !entry || this.hoverIndex === index) return;
    if (this.hoverIndex >= 0) {
      this.outlineMarkers[this.hoverIndex]?.removeClass('is-hovered');
    }
    this.hoverIndex = index;
    this.container.addClass('is-hovering');
    marker.addClass('is-hovered');
    this.setWaveTarget(index);
    this.showOutlinePreview(entry, marker);
  }

  private deactivateOutlineEntry(): void {
    if (this.hoverIndex >= 0) {
      this.outlineMarkers[this.hoverIndex]?.removeClass('is-hovered');
      this.hoverIndex = -1;
    }
    this.container.removeClass('is-hovering');
    this.hideOutlinePreview();
  }

  private showOutlinePreview(entry: ConversationOutlineEntry, marker: HTMLElement): void {
    const preview = this.outlinePreview;
    const titleEl = this.outlinePreviewTitleEl;
    const excerptEl = this.outlinePreviewExcerptEl;
    const badgeEl = this.outlinePreviewBadgeEl;
    if (!preview || !titleEl || !excerptEl || !badgeEl) return;

    const index = this.outlineMarkers.indexOf(marker);
    this.resolveEntryTarget(entry);
    titleEl.setText(entry.title);
    const hasExcerpt = Boolean(entry.excerpt);
    excerptEl.setText(entry.excerpt ?? '');
    excerptEl.toggleClass('is-hidden', !hasExcerpt);
    preview.toggleClass('has-preview', hasExcerpt);
    const hasBadge = index >= 0 && Boolean(entry.badge);
    badgeEl.setText(hasBadge ? `${entry.badge}${index + 1}` : '');
    badgeEl.toggleClass('is-hidden', !hasBadge);

    this.positionOutlinePreview(preview, marker);
    preview.addClass('is-visible');
    marker.setAttribute('aria-describedby', preview.getAttribute('id') ?? '');
    this.outlinePreviewTrigger = marker;
  }

  private positionOutlinePreview(preview: HTMLElement, marker: HTMLElement): void {
    const markerRect = marker.getBoundingClientRect?.();
    if (!markerRect) return;

    const markerCenter = markerRect.top + markerRect.height / 2;
    const previewHeight = preview.offsetHeight || 120;
    const previewWidth = preview.offsetWidth || 240;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const edgePadding = 8;
    const gap = 10;
    const minTop = edgePadding + previewHeight / 2;
    const maxTop = viewportHeight - edgePadding - previewHeight / 2;
    const top = maxTop >= minTop
      ? Math.max(minTop, Math.min(markerCenter, maxTop))
      : viewportHeight / 2;
    preview.style.setProperty('--claudian-plus-outline-preview-top', `${top}px`);

    const isRightSide = this.container.classList.contains('claudian-plus-nav-outline-right');
    let left = isRightSide
      ? markerRect.left - gap - previewWidth
      : markerRect.right + gap;
    if (isRightSide ? left < edgePadding : left + previewWidth > viewportWidth - edgePadding) {
      left = isRightSide ? markerRect.right + gap : markerRect.left - gap - previewWidth;
    }
    const clampedLeft = Math.max(
      edgePadding,
      Math.min(left, viewportWidth - edgePadding - previewWidth),
    );
    preview.style.setProperty('--claudian-plus-outline-preview-left', `${clampedLeft}px`);
  }

  private hideOutlinePreview(): void {
    this.outlinePreviewTrigger?.removeAttribute('aria-describedby');
    this.outlinePreviewTrigger = null;
    this.outlinePreview?.removeClass('is-visible');
  }

  private setWaveTarget(index: number): void {
    if (this.waveAmplitude < 0.01) {
      this.wavePosition = index;
      this.waveVelocity = 0;
    }
    this.waveTarget = index;
    this.waveActive = true;
    this.ensureWaveAnimation();
  }

  private releaseWaveFocus(): void {
    this.waveActive = false;
    this.ensureWaveAnimation();
  }

  private ensureWaveAnimation(): void {
    if (this.waveFrame !== null) return;
    const ownerWindow = this.messagesEl.ownerDocument.defaultView;
    if (!ownerWindow) return;
    if (ownerWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.waveAmplitude = 0;
      this.waveVelocity = 0;
      return;
    }

    const animate = (): void => {
      const targetAmplitude = this.waveActive ? 1 : 0;
      this.waveAmplitude += (targetAmplitude - this.waveAmplitude)
        * (this.waveActive ? 0.2 : 0.11);

      if (this.waveActive) {
        const force = (this.waveTarget - this.wavePosition) * 0.2;
        this.waveVelocity = (this.waveVelocity + force) * 0.68;
        this.wavePosition += this.waveVelocity;
      } else {
        this.waveVelocity *= 0.78;
        this.wavePosition += this.waveVelocity;
      }

      this.outlineMarkers.forEach((marker, index) => {
        const level = Number(marker.getAttribute('data-outline-level') ?? 1) as 1 | 2 | 3;
        const baseWidth = level === 1 ? 27 : level === 2 ? 20 : 15;
        const distance = index - this.wavePosition;
        const influence = Math.exp(-(distance * distance) / (2 * WAVE_SIGMA * WAVE_SIGMA));
        const width = baseWidth + (WAVE_PEAK_WIDTH - baseWidth) * influence * this.waveAmplitude;
        marker.style.setProperty('--cp-nav-tick-w', `${width.toFixed(2)}px`);
      });

      const settled = !this.waveActive
        && this.waveAmplitude < 0.008
        && Math.abs(this.waveVelocity) < 0.008;
      if (settled) {
        this.waveAmplitude = 0;
        this.waveVelocity = 0;
        for (const marker of this.outlineMarkers) {
          marker.style.removeProperty('--cp-nav-tick-w');
        }
        this.waveFrame = null;
        return;
      }
      this.waveFrame = ownerWindow.requestAnimationFrame(animate);
    };
    this.waveFrame = ownerWindow.requestAnimationFrame(animate);
  }

  collapse(): void {
    this.hoverIndex = -1;
    this.container.removeClass('is-hovering');
    this.hideOutlinePreview();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.pendingVisibilityFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingVisibilityFrame);
      this.pendingVisibilityFrame = null;
    }
    this.pendingOutlineReposition = false;
    if (this.pendingOutlineRefresh !== null) {
      this.pendingOutlineRefresh.ownerWindow.clearTimeout(this.pendingOutlineRefresh.id);
      this.pendingOutlineRefresh = null;
    }
    if (this.waveFrame !== null) {
      this.messagesEl.ownerDocument.defaultView?.cancelAnimationFrame(this.waveFrame);
      this.waveFrame = null;
    }
    this.collapse();
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.messagesEl.removeEventListener('scroll', this.scrollHandler);
    this.parentEl.classList.remove('claudian-plus-has-nav-sidebar');
    this.parentEl.classList.remove('claudian-plus-nav-outline-right');
    this.container.remove();
    this.outlinePreview?.remove();
    this.outlinePreview = null;
    this.outlinePreviewTitleEl = null;
    this.outlinePreviewExcerptEl = null;
    this.outlinePreviewBadgeEl = null;
  }

  private scrollToElement(el: HTMLElement): void {
    this.messagesEl.scrollTo({
      top: Math.max(this.getElementTop(el) - 10, 0),
      behavior: this.getScrollBehavior(),
    });
  }

  private getScrollBehavior(): ScrollBehavior {
    const ownerWindow = this.messagesEl.ownerDocument.defaultView;
    return ownerWindow?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
  }

  private resolveEntryTarget(entry: ConversationOutlineEntry): HTMLElement {
    if (this.messagesEl.contains(entry.targetEl)) return entry.targetEl;
    return this.messagesEl.contains(entry.messageEl) ? entry.messageEl : this.messagesEl;
  }

  private getElementTop(el: HTMLElement, containerRect: DOMRect | null = null): number {
    if (
      typeof el.getBoundingClientRect === 'function'
      && typeof this.messagesEl.getBoundingClientRect === 'function'
    ) {
      const targetRect = el.getBoundingClientRect();
      const resolvedContainerRect = containerRect ?? this.messagesEl.getBoundingClientRect();
      return this.messagesEl.scrollTop + targetRect.top - resolvedContainerRect.top;
    }

    let top = 0;
    let current: HTMLElement | null = el;
    while (current && current !== this.messagesEl) {
      top += current.offsetTop;
      current = current.parentElement;
    }
    return top;
  }
}
