import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import { formatConversationDirectoryTitle } from '../utils/conversationDirectoryTitle';

type ConversationOutlineKind = 'prompt' | 'heading';
type ConversationOutlineLevel = 1 | 2 | 3;

interface ConversationOutlineEntry {
  targetEl: HTMLElement;
  messageEl: HTMLElement;
  title: string;
  excerpt: string;
  badge: string;
  kind: ConversationOutlineKind;
  level: ConversationOutlineLevel;
}

const OUTLINE_EXCERPT_LENGTH = 140;
const OUTLINE_REFRESH_DELAY_MS = 80;
// Wave TOC peaks at 51px: the hovered H1 grows from 27px to 51px and the
// gaussian ripple sweeps the neighboring ticks. The transcript gutter is
// sized to keep the peak clear of the text (see messages.css).
const WAVE_PEAK_WIDTH = 51;
const WAVE_SIGMA = 1.55;
let nextOutlinePreviewId = 0;

function normalizeOutlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateOutlineText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

/**
 * Floating conversation outline rail.
 * Renders a track of horizontal tick markers sized to the transcript height.
 */
export class NavigationSidebar {
  private container: HTMLElement;
  private outlineTrack: HTMLElement;
  private outlineEntries: ConversationOutlineEntry[] = [];
  private outlineEntriesByMessage = new Map<HTMLElement, ConversationOutlineEntry[]>();
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
  private pendingOutlineMessages = new Set<HTMLElement>();
  private pendingFullOutlineRefresh = false;
  private isVisible: boolean | null = null;
  private destroyed = false;
  private side: 'left' | 'right';
  private waveFrame: number | null = null;
  private wavePosition = 0;
  private waveVelocity = 0;
  private waveAmplitude = 0;
  private waveTarget = 0;
  private waveActive = false;

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
    // tabIndex=-1 lets the container receive focus from container-level
    // shortcuts without participating in the regular tab order.

    // Outline track holds horizontal tick markers sized to the transcript height.
    this.outlineTrack = this.container.createDiv({ cls: 'claudian-plus-nav-outline-track' });
    this.outlineTrack.setAttribute('role', 'navigation');
    this.outlineTrack.setAttribute('aria-label', 'Conversation outline');

    // Persistent hover bubble (Wave TOC model): one card is created per
    // sidebar and shown/hidden via is-visible, so it follows the pointer
    // across ticks with a single smooth CSS transition instead of being
    // recreated (and flickering) on every hover change. It lives in the
    // document body so its position:fixed stays viewport-anchored regardless
    // of transforms, containment, or overflow on chat containers.
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
    // Scroll handling to toggle visibility
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

    // Wave TOC rail interaction: hovering anywhere in the tick strip selects
    // the nearest marker, so the wave, the is-hovering tint, and the preview
    // bubble follow the pointer even between the thin ticks. Clicking the
    // strip jumps to the hovered entry.
    this.outlineTrack.addEventListener('mousemove', (event: MouseEvent) => {
      this.hoverOutlineAt(event.clientY);
    });
    this.outlineTrack.addEventListener('click', (event: MouseEvent) => {
      if (this.hoverIndex < 0 || this.destroyed) return;
      event.stopPropagation();
      const entry = this.outlineEntries[this.hoverIndex];
      if (entry) {
        this.scrollToElement(this.resolveEntryTarget(entry));
        this.deactivateOutlineEntry();
      }
    });
    this.outlineTrack.addEventListener('mouseleave', () => {
      this.deactivateOutlineEntry();
      this.releaseWaveFocus();
    });

    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver((mutations) => {
        if (this.destroyed) return;
        this.updateVisibility();
        const outlineMutations = mutations.filter(mutation => this.mutationAffectsOutline(mutation));
        if (outlineMutations.length > 0) {
          this.scheduleOutlineRefresh(outlineMutations);
        }
      });
      this.mutationObserver.observe(this.messagesEl, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-toc-title'],
        characterData: true,
      });
    }

    // A pane can change height or width without mutating the transcript. In
    // that case scrollability, text wrapping, and marker positions all change
    // together, so a scroll-only update leaves a stale rail behind.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.destroyed) return;
        this.scheduleLayoutUpdate(true);
      });
      this.resizeObserver.observe(this.messagesEl);
      if (this.parentEl !== this.messagesEl) {
        this.resizeObserver.observe(this.parentEl);
      }
    }
  }

  /**
   * Updates visibility of the sidebar based on scroll state.
   * Visible if content overflows.
   */
  updateVisibility(): void {
    if (this.destroyed) return;
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

  private scheduleOutlineRefresh(mutations: MutationRecord[]): void {
    if (this.destroyed) return;
    this.queueOutlineMutations(mutations);
    if (this.pendingOutlineRefresh !== null) return;
    const ownerWindow = this.messagesEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      const dirtyMessages = this.pendingFullOutlineRefresh
        ? null
        : new Set(this.pendingOutlineMessages);
      this.pendingFullOutlineRefresh = false;
      this.pendingOutlineMessages.clear();
      this.refreshOutline(dirtyMessages);
      return;
    }
    const id = ownerWindow.setTimeout(() => {
      this.pendingOutlineRefresh = null;
      if (this.destroyed) return;
      const dirtyMessages = this.pendingFullOutlineRefresh
        ? null
        : new Set(this.pendingOutlineMessages);
      this.pendingFullOutlineRefresh = false;
      this.pendingOutlineMessages.clear();
      this.refreshOutline(dirtyMessages);
    }, OUTLINE_REFRESH_DELAY_MS);
    this.pendingOutlineRefresh = { id, ownerWindow };
  }

  private collectMessageOutlineEntries(messageEl: HTMLElement): ConversationOutlineEntry[] {
    const entries: ConversationOutlineEntry[] = [];
    if (!this.isUserMessageElement(messageEl)) return entries;
    const title = this.getDirectoryTitle(messageEl);
    if (!title) return entries;
    entries.push({
      targetEl: messageEl,
      messageEl,
      title,
      excerpt: this.getAssistantResponseExcerpt(messageEl),
      badge: 'Q',
      kind: 'prompt',
      level: this.getOutlineLevelForTitle(title),
    });
    return entries;
  }

  /**
   * Wave TOC varies tick length by heading depth. A chat transcript has no
   * heading hierarchy, so prompts are bucketed by title length into the same
   * three bar widths (27/20/15px) for the same organic, non-uniform look.
   */
  private getOutlineLevelForTitle(title: string): ConversationOutlineLevel {
    if (title.length < 16) return 3;
    if (title.length <= 32) return 2;
    return 1;
  }

  private collectOutlineEntries(
    dirtyMessages: Set<HTMLElement> | null = null,
  ): ConversationOutlineEntry[] {
    const messageEls = Array.from(this.messagesEl.querySelectorAll<HTMLElement>(
      '.claudian-plus-message-user, [data-role="user"]',
    ));
    const currentMessages = new Set(messageEls);
    for (const cachedMessage of this.outlineEntriesByMessage.keys()) {
      if (!currentMessages.has(cachedMessage)) this.outlineEntriesByMessage.delete(cachedMessage);
    }

    const entries: ConversationOutlineEntry[] = [];
    for (const messageEl of messageEls) {
      if (
        dirtyMessages === null
        || dirtyMessages.has(messageEl)
        || !this.outlineEntriesByMessage.has(messageEl)
      ) {
        this.outlineEntriesByMessage.set(
          messageEl,
          this.collectMessageOutlineEntries(messageEl),
        );
      }
      entries.push(...(this.outlineEntriesByMessage.get(messageEl) ?? []));
    }
    return entries;
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

  private getDirectoryTitle(el: HTMLElement): string {
    const explicitTitle = (el.getAttribute('data-toc-title') ?? '').trim();
    if (explicitTitle) return explicitTitle;

    const contentEl = el.querySelector<HTMLElement>('.claudian-plus-message-content');
    return formatConversationDirectoryTitle(contentEl?.textContent ?? el.textContent ?? '');
  }

  private getAssistantResponseExcerpt(userMsgEl: HTMLElement): string {
    let sibling = userMsgEl.nextElementSibling as HTMLElement | null;
    while (sibling) {
      // Consecutive user messages occur when a turn is queued, retried, or
      // steered. Do not borrow the next turn's response as this prompt's
      // directory preview.
      if (this.isUserMessageElement(sibling)) {
        return '';
      }
      const isAssistant = sibling.classList?.contains?.('claudian-plus-message-assistant')
        || sibling.getAttribute?.('data-role') === 'assistant';
      if (isAssistant) {
        const textBlocks = sibling.querySelectorAll<HTMLElement>('.claudian-plus-text-block');
        if (textBlocks.length > 0) {
          const parts: string[] = [];
          for (const block of textBlocks) {
            const text = normalizeOutlineText(block.textContent ?? '');
            if (text) parts.push(text);
          }
          return truncateOutlineText(parts.join(' '), OUTLINE_EXCERPT_LENGTH);
        }
        return '';
      }
      sibling = sibling.nextElementSibling as HTMLElement | null;
    }
    return '';
  }

  private resolveEntryTarget(entry: ConversationOutlineEntry): HTMLElement {
    if (this.messagesEl.contains(entry.targetEl)) return entry.targetEl;
    return this.messagesEl.contains(entry.messageEl) ? entry.messageEl : this.messagesEl;
  }

  private isUserMessageElement(el: HTMLElement): boolean {
    return el.classList.contains('claudian-plus-message-user')
      || el.getAttribute('data-role') === 'user';
  }

  private isAssistantMessageElement(el: HTMLElement): boolean {
    return el.classList.contains('claudian-plus-message-assistant')
      || el.getAttribute('data-role') === 'assistant';
  }

  private isOutlineMessageElement(node: Node | null): node is HTMLElement {
    if (!node) return false;
    const candidate = node as {
      classList?: { contains?: (className: string) => boolean };
      getAttribute?: (name: string) => string | null;
    };
    return candidate.classList?.contains?.('claudian-plus-message-user') === true
      || candidate.getAttribute?.('data-role') === 'user';
  }

  private nodeContainsOutlineMessage(node: Node): boolean {
    if (this.isOutlineMessageElement(node)) return true;
    const candidate = node as { querySelector?: (selector: string) => Element | null };
    return typeof candidate.querySelector === 'function'
      && candidate.querySelector(
        '.claudian-plus-message-user, [data-role="user"]',
      ) !== null;
  }

  private findContainingOutlineMessage(node: Node | null): HTMLElement | null {
    let current = node;
    while (current && current !== this.messagesEl) {
      if (this.isOutlineMessageElement(current)) return current;
      current = current.parentNode;
    }
    return null;
  }

  /** Finds the user prompt whose directory preview is affected by a DOM change. */
  private findAssociatedOutlineMessage(node: Node | null): HTMLElement | null {
    const directMessage = this.findContainingOutlineMessage(node);
    if (directMessage) return directMessage;

    let current = node as HTMLElement | null;
    while (current && current !== this.messagesEl) {
      if (this.isAssistantMessageElement(current)) {
        let sibling = current.previousElementSibling as HTMLElement | null;
        while (sibling) {
          if (this.isUserMessageElement(sibling)) return sibling;
          sibling = sibling.previousElementSibling as HTMLElement | null;
        }
        return null;
      }
      current = current.parentElement;
    }
    return null;
  }

  private queueOutlineMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (this.pendingFullOutlineRefresh) return;
      if (mutation.type === 'childList') {
        const changedNodes = [
          ...Array.from(mutation.addedNodes),
          ...Array.from(mutation.removedNodes),
        ];
        if (changedNodes.some(node => this.nodeContainsOutlineMessage(node))) {
          this.pendingFullOutlineRefresh = true;
          this.pendingOutlineMessages.clear();
          continue;
        }

        const associatedMessage = this.findAssociatedOutlineMessage(mutation.target)
          ?? changedNodes
            .map(node => this.findAssociatedOutlineMessage(node))
            .find((message): message is HTMLElement => message !== null);
        if (associatedMessage) {
          this.pendingOutlineMessages.add(associatedMessage);
          continue;
        }
      }

      const messageEl = this.findAssociatedOutlineMessage(mutation.target);
      if (messageEl) {
        this.pendingOutlineMessages.add(messageEl);
      } else {
        this.pendingFullOutlineRefresh = true;
        this.pendingOutlineMessages.clear();
      }
    }
  }

  private mutationAffectsOutline(mutation: MutationRecord): boolean {
    if (mutation.type === 'attributes') {
      return mutation.attributeName === 'data-toc-title'
        && this.findAssociatedOutlineMessage(mutation.target) !== null;
    }
    if (mutation.type === 'characterData') return this.findAssociatedOutlineMessage(mutation.target) !== null;
    if (mutation.type !== 'childList') return false;
    if (this.findAssociatedOutlineMessage(mutation.target)) return true;
    return [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)].some(node => (
      this.findAssociatedOutlineMessage(node) !== null
    ));
  }

  private refreshOutline(dirtyMessages: Set<HTMLElement> | null = null): void {
    if (this.destroyed) return;
    const nextEntries = this.collectOutlineEntries(dirtyMessages);
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
      // Wave TOC keeps the bubble visible while the pointer moves across the
      // ticks; only leaving the rail hides it (track mouseleave below).
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

    // Wave TOC sizing: shrink the tick gap as the entry count grows so the
    // rail always fills (but never overflows) the track.
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
    // MutationObserver schedules visibility before its debounced outline scan.
    // Re-evaluate after the scan so a newly restored or removed conversation
    // cannot leave a stale rail (or a stale message gutter) behind.
    this.applyVisibility();
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
    // Markers are laid out by the track's flex gap, so no per-marker position
    // is required. This method stays as an extension point for future per
    // entry styling (e.g. heading levels, badges).
  }

  private repositionOutlineMarkers(): void {
    this.outlineMarkers.forEach((marker, index) => this.positionOutlineMarker(marker, index));
  }

  /** Selects the nearest marker to a pointer Y within the tick strip. */
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

  /**
   * Highlights a marker as the wave peak: deepens the tick, dims the
   * previously active tick back to the resting tint, and shows its bubble.
   */
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

    // Both sidebar and preview are position:fixed — use viewport coords. The
    // bubble is vertically centered on the marker via translateY(-50%) in
    // CSS, so the marker center is clamped by half the bubble height.
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

    // Bubble opens toward the chat content: right of the rail by default, or
    // left of the rail when the rail sits on the right side. Flip to the
    // other side when it would overflow the viewport.
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
    // The persistent bubble stays in the DOM; removing is-visible plays the
    // CSS fade/scale transition out (Wave TOC behavior).
    this.outlinePreview?.removeClass('is-visible');
  }

  /**
   * Spring-physics wave (ported from Wave TOC): the wave peak chases the
   * hovered tick, and each marker's bar width follows a gaussian of its
   * distance from the peak, so the ripple sweeps across the rail.
   */
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
    // Collapse hides transient surfaces immediately; the persistent bubble is
    // left in place (hidden) and removed with the sidebar on destroy().
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
    this.pendingOutlineMessages.clear();
    this.outlineEntriesByMessage.clear();
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
    // The persistent bubble lives in parentEl (fixed positioning), so it is
    // removed separately from the sidebar container.
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
