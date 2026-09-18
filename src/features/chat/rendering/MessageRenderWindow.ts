import type { ChatMessage } from '../../../core/types';

/** Entries rendered on first paint of a conversation. */
export const INITIAL_WINDOW_SIZE = 40;
/** Hard cap on simultaneously rendered stored (history) entries. */
export const MAX_WINDOW_SIZE = 120;
/** Entries loaded per scroll-triggered page load. */
export const WINDOW_PAGE_STEP = 40;

/** scrollTop at or below which older history loads. */
const TOP_LOAD_THRESHOLD = 1;
/** Distance from the container bottom within which newer history loads. */
const BOTTOM_LOAD_THRESHOLD = 80;

export interface RenderedStoredEntry {
  readonly messageId: string;
  /** Index of the message in the conversation snapshot (original index). */
  readonly index: number;
  /** Top-level nodes created for the message (bubble, image strip, interrupt marker). */
  readonly nodes: HTMLElement[];
}

export interface MessageRenderWindowDeps {
  /**
   * Renders one stored message and returns every top-level node it appended to
   * the messages container (empty when the message renders nothing).
   */
  renderStoredMessage: (
    msg: ChatMessage,
    allMessages: ChatMessage[],
    index: number
  ) => HTMLElement[];
  /**
   * Releases renderer-owned resources (markdown components, scheduled UI
   * callbacks) before the window removes the nodes from the DOM.
   */
  releaseStoredNodes?: (nodes: HTMLElement[], messageId: string) => void;
  /**
   * First live-appended node (streaming turn, pending decision) that stored
   * nodes must stay in front of, or null when there is none.
   */
  getFirstLiveNode?: () => HTMLElement | null;
}

/**
 * Sliding render window over a conversation snapshot.
 *
 * The window keeps at most {@link MAX_WINDOW_SIZE} stored message nodes in the
 * DOM: it starts at the newest {@link INITIAL_WINDOW_SIZE} entries, grows
 * upward as the user scrolls to the top, and slides (releasing nodes at the
 * opposite end) once the cap is reached. Live nodes appended outside the
 * window are never tracked here, so streaming or decision-pending messages are
 * structurally protected from removal.
 *
 * Scroll anchoring: prepending older content shifts the user's viewport down,
 * so scrollTop is advanced by the measured height delta before any trimming;
 * trimming the oldest entries shifts content up, so scrollTop is rewound by
 * the measured height delta.
 */
export class MessageRenderWindow {
  private deps: MessageRenderWindowDeps;
  private messages: ChatMessage[] = [];
  private entries: RenderedStoredEntry[] = [];
  private startIndex = 0;
  private endIndex = 0;
  private collapseStates = new Map<string, boolean[]>();
  private scrollEl: HTMLElement | null = null;
  private scrollListener: (() => void) | null = null;
  private loadingPage = false;
  private disposed = false;

  constructor(deps: MessageRenderWindowDeps) {
    this.deps = deps;
  }

  // ============================================
  // Container
  // ============================================

  setContainer(el: HTMLElement | null): void {
    if (this.scrollEl === el) return;
    this.detachScrollListener();
    this.scrollEl = el;
    this.attachScrollListener();
  }

  // ============================================
  // Window state
  // ============================================

  get renderedCount(): number {
    return this.entries.length;
  }

  get firstRenderedIndex(): number | null {
    return this.entries[0]?.index ?? null;
  }

  get lastRenderedIndex(): number | null {
    return this.entries[this.entries.length - 1]?.index ?? null;
  }

  /** First snapshot index covered by the window (may render nothing). */
  get windowStartIndex(): number {
    return this.startIndex;
  }

  /** Exclusive last snapshot index covered by the window. */
  get windowEndIndex(): number {
    return this.endIndex;
  }

  isRendered(messageId: string): boolean {
    return this.entries.some((entry) => entry.messageId === messageId);
  }

  /**
   * Rebuilds the window for a freshly rendered conversation. Any previous
   * window state is discarded, so switching conversations never reuses the
   * previous window's result.
   */
  reset(messages: ChatMessage[]): void {
    this.clearEntries();
    this.collapseStates.clear();
    this.messages = messages;
    if (messages.length === 0) {
      this.startIndex = 0;
      this.endIndex = 0;
      return;
    }

    this.startIndex = Math.max(0, messages.length - INITIAL_WINDOW_SIZE);
    this.endIndex = messages.length;
    this.renderRange(this.startIndex, this.endIndex, 'append');
  }

  /** Drops window bookkeeping for a message removed outside the window. */
  forget(messageId: string): void {
    const entry = this.entries.find((candidate) => candidate.messageId === messageId);
    if (!entry) return;
    this.discardEntries([entry]);
    this.entries = this.entries.filter((candidate) => candidate !== entry);
  }

  dispose(): void {
    this.disposed = true;
    this.detachScrollListener();
    this.scrollEl = null;
  }

  // ============================================
  // Message targeting
  // ============================================

  /**
   * Ensures the message is rendered, switching the window to a page around it
   * when needed. Returns the message's primary node, or null when the message
   * is not part of the conversation snapshot.
   */
  ensureMessageRendered(messageId: string): HTMLElement | null {
    if (this.disposed) return null;

    const existing = this.entries.find((entry) => entry.messageId === messageId);
    if (existing) {
      return this.primaryNode(existing);
    }

    const index = this.messages.findIndex((msg) => msg.id === messageId);
    if (index === -1) return null;

    // Preserve the current browsing budget (capped) when switching pages.
    const size = Math.min(
      MAX_WINDOW_SIZE,
      Math.max(INITIAL_WINDOW_SIZE, this.entries.length)
    );
    let start = Math.max(0, index - Math.floor(size / 2));
    const end = Math.min(this.messages.length, start + size);
    start = Math.max(0, end - size);

    this.clearEntries();
    this.startIndex = start;
    this.endIndex = end;
    this.renderRange(start, end, 'append');

    const entry = this.entries.find((candidate) => candidate.messageId === messageId);
    return entry ? this.primaryNode(entry) : null;
  }

  // ============================================
  // Scrolling
  // ============================================

  /** Loads one page of older/newer history based on the scroll position. */
  handleScroll(): void {
    if (this.disposed || this.loadingPage) return;
    const el = this.scrollEl;
    if (!el) return;

    if (this.startIndex > 0 && el.scrollTop <= TOP_LOAD_THRESHOLD) {
      this.loadOlder();
      return;
    }
    if (this.endIndex < this.messages.length && this.isNearBottom(el)) {
      this.loadNewer();
    }
  }

  /**
   * Prepends up to WINDOW_PAGE_STEP older entries, trimming the newest entries
   * when the cap is exceeded and keeping the viewport anchored to the content
   * the user was looking at.
   */
  loadOlder(): number {
    if (this.disposed || this.loadingPage) return 0;
    if (this.startIndex <= 0) return 0;

    const take = Math.min(WINDOW_PAGE_STEP, this.startIndex);
    if (take <= 0) return 0;

    this.loadingPage = true;
    try {
      const el = this.scrollEl;
      const prevScrollHeight = el?.scrollHeight ?? 0;
      const prevScrollTop = el?.scrollTop ?? 0;

      const newStart = this.startIndex - take;
      const added = this.renderRange(newStart, this.startIndex, 'prepend');
      this.startIndex = newStart;

      // Prepending shifts the viewed content down by the added height.
      if (el && added > 0) {
        el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight);
      }

      this.trimNewestToCap();
      return added;
    } finally {
      this.loadingPage = false;
    }
  }

  /**
   * Appends up to WINDOW_PAGE_STEP newer entries, trimming the oldest entries
   * when the cap is exceeded and rewinding scrollTop by the removed height.
   */
  loadNewer(): number {
    if (this.disposed || this.loadingPage) return 0;
    if (this.endIndex >= this.messages.length) return 0;

    const take = Math.min(WINDOW_PAGE_STEP, this.messages.length - this.endIndex);
    if (take <= 0) return 0;

    this.loadingPage = true;
    try {
      const added = this.renderRange(this.endIndex, this.endIndex + take, 'append');
      this.endIndex += take;

      // Trimming the oldest entries shifts the viewed content up.
      const el = this.scrollEl;
      if (el) {
        const removedHeight = this.trimOldestToCap();
        if (removedHeight > 0) {
          el.scrollTop = Math.max(0, el.scrollTop - removedHeight);
        }
      }
      return added;
    } finally {
      this.loadingPage = false;
    }
  }

  // ============================================
  // Rendering
  // ============================================

  private renderRange(
    start: number,
    end: number,
    mode: 'append' | 'prepend'
  ): number {
    const reference = mode === 'prepend'
      ? this.entries[0]?.nodes[0] ?? null
      : this.deps.getFirstLiveNode?.() ?? null;

    const createdEntries: RenderedStoredEntry[] = [];
    for (let index = start; index < end; index++) {
      const msg = this.messages[index];
      if (!msg) continue;
      const nodes = this.deps.renderStoredMessage(msg, this.messages, index);
      if (nodes.length === 0) continue;
      this.restoreCollapseState(msg.id, nodes);
      createdEntries.push({ messageId: msg.id, index, nodes });
    }

    if (createdEntries.length > 0) {
      const nodes = createdEntries.flatMap((entry) => entry.nodes);
      this.placeNodes(nodes, reference);
      this.entries = mode === 'prepend'
        ? [...createdEntries, ...this.entries]
        : [...this.entries, ...createdEntries];
    }
    return createdEntries.length;
  }

  /**
   * Ensures freshly created nodes end up in the messages container in creation
   * order. `reference` is the node the batch must precede (live-node boundary
   * or, for prepends, the previously first stored node); nodes are moved with
   * insert-before semantics, which is a no-op reorder when they are already in
   * place.
   */
  private placeNodes(nodes: HTMLElement[], reference: HTMLElement | null): void {
    const container = this.scrollEl;
    if (!container) return;
    const resolvedReference = reference && container.contains(reference)
      ? reference
      : null;
    for (const node of nodes) {
      container.insertBefore(node, resolvedReference);
    }
  }

  private clearEntries(): void {
    this.discardEntries(this.entries);
    this.entries = [];
  }

  private releaseStoredNodes(entry: RenderedStoredEntry): void {
    this.deps.releaseStoredNodes?.(entry.nodes, entry.messageId);
  }

  private trimNewestToCap(): void {
    const excess = this.entries.length - MAX_WINDOW_SIZE;
    if (excess <= 0) return;
    const removed = this.entries.slice(this.entries.length - excess);
    this.entries = this.entries.slice(0, this.entries.length - excess);
    this.discardEntries(removed);
    this.endIndex = (this.entries[this.entries.length - 1]?.index ?? this.startIndex - 1) + 1;
  }

  private trimOldestToCap(): number {
    const excess = this.entries.length - MAX_WINDOW_SIZE;
    if (excess <= 0) return 0;
    const el = this.scrollEl;
    const heightBefore = el?.scrollHeight ?? 0;
    const removed = this.entries.slice(0, excess);
    this.entries = this.entries.slice(excess);
    this.discardEntries(removed);
    this.startIndex = this.entries[0]?.index ?? this.endIndex;
    return Math.max(0, heightBefore - (el?.scrollHeight ?? 0));
  }

  private discardEntries(entries: RenderedStoredEntry[]): void {
    for (const entry of entries) {
      this.captureCollapseState(entry);
      this.releaseStoredNodes(entry);
      for (const node of entry.nodes) {
        node.remove();
      }
    }
  }

  // ============================================
  // Collapse state preservation
  // ============================================

  private captureCollapseState(entry: RenderedStoredEntry): void {
    const states: boolean[] = [];
    for (const node of entry.nodes) {
      const headers = node.querySelectorAll<HTMLElement>('[aria-expanded]');
      for (const header of headers) {
        states.push(header.getAttribute('aria-expanded') === 'true');
      }
    }
    if (states.length > 0) {
      this.collapseStates.set(entry.messageId, states);
    }
  }

  private restoreCollapseState(messageId: string, nodes: HTMLElement[]): void {
    const recorded = this.collapseStates.get(messageId);
    if (!recorded) return;

    let position = 0;
    for (const node of nodes) {
      const headers = node.querySelectorAll<HTMLElement>('[aria-expanded]');
      for (const header of headers) {
        const desired = recorded[position++];
        if (desired === undefined) return;
        const isExpanded = header.getAttribute('aria-expanded') === 'true';
        if (isExpanded !== desired) {
          header.click();
        }
      }
    }
  }

  // ============================================
  // Scroll plumbing
  // ============================================

  private attachScrollListener(): void {
    if (!this.scrollEl || this.disposed) return;
    this.scrollListener = () => this.handleScroll();
    this.scrollEl.addEventListener('scroll', this.scrollListener);
  }

  private detachScrollListener(): void {
    if (this.scrollEl && this.scrollListener) {
      this.scrollEl.removeEventListener('scroll', this.scrollListener);
    }
    this.scrollListener = null;
  }

  private isNearBottom(el: HTMLElement): boolean {
    const clientHeight = (el as HTMLElement & { clientHeight?: number }).clientHeight ?? 0;
    const distance = el.scrollHeight - el.scrollTop - clientHeight;
    return distance <= BOTTOM_LOAD_THRESHOLD;
  }

  private primaryNode(entry: RenderedStoredEntry): HTMLElement {
    const explicit = entry.nodes.find(
      (node) => node.getAttribute?.('data-message-id') === entry.messageId
    );
    return explicit ?? entry.nodes[0];
  }
}
