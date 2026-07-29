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
  private outlinePreview: HTMLElement | null = null;
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
  private outlineStyle: 'bar' | 'dot';

  constructor(
    private parentEl: HTMLElement,
    private messagesEl: HTMLElement,
    outlineStyle: 'bar' | 'dot' = 'bar',
  ) {
    this.outlineStyle = outlineStyle;
    this.container = this.parentEl.createDiv({ cls: 'claudian-plus-nav-sidebar' });
    this.container.setAttribute('aria-label', 'Conversation outline sidebar');
    this.applyOutlineStyle();
    this.container.tabIndex = -1;
    // tabIndex=-1 lets the container receive focus from container-level
    // shortcuts without participating in the regular tab order.

    // Outline track holds horizontal tick markers sized to the transcript height.
    this.outlineTrack = this.container.createDiv({ cls: 'claudian-plus-nav-outline-track' });
    this.outlineTrack.setAttribute('role', 'navigation');
    this.outlineTrack.setAttribute('aria-label', 'Conversation outline');

    this.setupEventListeners();
    this.refreshOutline();
    this.applyVisibility();
  }

  setOutlineStyle(style: 'bar' | 'dot'): void {
    if (this.outlineStyle === style) return;
    this.outlineStyle = style;
    this.applyOutlineStyle();
    // Rebuild markers so the dot element rendering reflects the new mode.
    this.refreshOutline();
  }

  private applyOutlineStyle(): void {
    this.container.classList.toggle('claudian-plus-nav-outline-dot-mode', this.outlineStyle === 'dot');
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

    // Wave-focus effect (from codian dot navigation): dots near the
    // hovered marker grow in proportion to their distance.
    this.outlineTrack.addEventListener('mouseleave', () => {
      this.resetWaveFocus();
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
      level: 1,
    });
    return entries;
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
    this.hideOutlinePreview();
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
      // Dot marker (codian-style circle) coexists with the ::before bar.
      marker.createSpan({ cls: 'claudian-plus-nav-outline-dot' });
      this.positionOutlineMarker(marker, index);
      this.outlineMarkers.push(marker);

      const selectEntry = (event?: Event): void => {
        event?.stopPropagation();
        this.scrollToElement(this.resolveEntryTarget(entry));
        this.hideOutlinePreview();
      };
      marker.addEventListener('click', selectEntry);
      marker.addEventListener('mouseenter', () => {
        this.applyWaveFocus(index);
        this.showOutlinePreview(entry, marker);
      });
      marker.addEventListener('mouseleave', () => this.hideOutlinePreview());
      marker.addEventListener('focus', () => this.showOutlinePreview(entry, marker));
      marker.addEventListener('blur', () => this.hideOutlinePreview());
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

  private showOutlinePreview(entry: ConversationOutlineEntry, marker: HTMLElement): void {
    this.hideOutlinePreview();
    const index = this.outlineMarkers.indexOf(marker);
    this.resolveEntryTarget(entry);
    const preview = this.parentEl.createDiv({ cls: 'claudian-plus-nav-outline-preview' });
    const previewId = `claudian-plus-outline-preview-${++nextOutlinePreviewId}`;
    preview.setAttribute('id', previewId);
    preview.setAttribute('role', 'tooltip');
    marker.setAttribute('aria-describedby', previewId);
    preview.createDiv({ cls: 'claudian-plus-nav-outline-preview-title', text: entry.title });
    if (entry.excerpt) {
      preview.createDiv({
        cls: 'claudian-plus-nav-outline-preview-excerpt',
        text: entry.excerpt,
      });
    }
    if (index >= 0 && entry.badge) {
      const badge = preview.createDiv({
        cls: 'claudian-plus-nav-outline-preview-badge',
        text: `${entry.badge}${index + 1}`,
      });
      badge.setAttribute('aria-hidden', 'true');
    }
    this.positionOutlinePreview(preview, marker);
    this.outlinePreview = preview;
    this.outlinePreviewTrigger = marker;
  }

  private positionOutlinePreview(preview: HTMLElement, marker: HTMLElement): void {
    const markerRect = marker.getBoundingClientRect?.();
    if (!markerRect) return;

    // Both sidebar and preview are position:fixed — use viewport coords.
    const markerCenter = markerRect.top + markerRect.height / 2;
    const previewHeight = preview.offsetHeight || 120;
    const viewportHeight = window.innerHeight;
    const edgePadding = 12;
    const minTop = edgePadding;
    const maxTop = viewportHeight - edgePadding - previewHeight;
    const top = maxTop >= minTop
      ? Math.max(minTop, Math.min(markerCenter - previewHeight / 2, maxTop))
      : viewportHeight / 2 - previewHeight / 2;
    preview.style.setProperty('--claudian-plus-outline-preview-top', `${top}px`);
  }

  private hideOutlinePreview(): void {
    const preview = this.outlinePreview;
    if (!preview) return;
    this.outlinePreview = null;
    this.outlinePreviewTrigger?.removeAttribute('aria-describedby');
    this.outlinePreviewTrigger = null;
    if (this.destroyed) {
      preview.remove();
      return;
    }
    // Play a soft exit animation so the card does not vanish abruptly when
    // the user moves between markers.
    preview.classList.add('claudian-plus-nav-outline-preview-leaving');
    const ownerWindow = this.messagesEl.ownerDocument.defaultView;
    const cleanup = () => {
      if (preview.dataset['claudianCollapsed'] === '1') return;
      preview.remove();
    };
    preview.addEventListener('animationend', cleanup, { once: true });
    ownerWindow?.setTimeout(cleanup, 160);
  }

  /**
   * Wave-focus effect from codian dot navigation: dots near the hovered
   * marker scale up based on their distance, creating a ripple.
   */
  private applyWaveFocus(focusIndex: number): void {
    this.outlineMarkers.forEach((marker, index) => {
      const distance = Math.abs(index - focusIndex);
      const size = Math.max(5, 10 - distance * 2);
      const dot = marker.querySelector<HTMLElement>('.claudian-plus-nav-outline-dot');
      if (dot) {
        dot.style.width = `${size}px`;
        dot.style.height = `${size}px`;
      }
    });
  }

  private resetWaveFocus(): void {
    for (const marker of this.outlineMarkers) {
      const dot = marker.querySelector<HTMLElement>('.claudian-plus-nav-outline-dot');
      if (dot) {
        dot.style.width = '';
        dot.style.height = '';
      }
    }
  }

  collapse(): void {
    // Skip the exit animation when collapsing — the entire sidebar is going
    // away so the listener should not see a fading card mid-transition.
    // Mark the element so a still-pending hideOutlinePreview timeout can
    // detect that it was already removed and skip the double-remove.
    const preview = this.outlinePreview;
    this.outlinePreview = null;
    this.outlinePreviewTrigger?.removeAttribute('aria-describedby');
    this.outlinePreviewTrigger = null;
    if (preview) {
      preview.dataset['claudianCollapsed'] = '1';
      preview.remove();
    }
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
    this.collapse();
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.messagesEl.removeEventListener('scroll', this.scrollHandler);
    this.parentEl.classList.remove('claudian-plus-has-nav-sidebar');
    this.container.remove();
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