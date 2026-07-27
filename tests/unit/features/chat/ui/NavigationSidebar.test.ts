import { NavigationSidebar } from '@/features/chat/ui/NavigationSidebar';

// Mock obsidian
jest.mock('obsidian', () => ({
  setIcon: jest.fn((el: any, iconName: string) => {
    el.setAttribute('data-icon', iconName);
  }),
}));

type Listener = (event: any) => void;

class MockClassList {
  private classes = new Set<string>();

  add(...items: string[]): void {
    items.forEach((item) => this.classes.add(item));
  }

  remove(...items: string[]): void {
    items.forEach((item) => this.classes.delete(item));
  }

  contains(item: string): boolean {
    return this.classes.has(item);
  }

  toggle(item: string, force?: boolean): void {
    if (force === undefined) {
      if (this.classes.has(item)) {
        this.classes.delete(item);
      } else {
        this.classes.add(item);
      }
      return;
    }
    if (force) {
      this.classes.add(item);
    } else {
      this.classes.delete(item);
    }
  }

  clear(): void {
    this.classes.clear();
  }

  toArray(): string[] {
    return Array.from(this.classes);
  }
}

class MockElement {
  tagName: string;
  classList = new MockClassList();
  style = {
    setProperty: (name: string, value: string): void => {
      this.style[name] = value;
    },
  } as Record<string, string> & { setProperty(name: string, value: string): void };
  ownerDocument: { defaultView: Window | null; activeElement?: MockElement | null };
  children: MockElement[] = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  parent: MockElement | null = null;
  textContent = '';
  private _scrollTop = 0;
  private _scrollHeight = 500;
  private _clientHeight = 500;
  private listeners: Record<string, Listener[]> = {};
  public scrollToCalls: Array<{ top: number; behavior: string }> = [];

  offsetTop = 0;
  offsetHeight = 2;

  get parentElement(): MockElement | null {
    return this.parent;
  }

  get parentNode(): MockElement | null {
    return this.parent;
  }

  get nextElementSibling(): MockElement | null {
    if (!this.parent) return null;
    const index = this.parent.children.indexOf(this);
    return index >= 0 ? this.parent.children[index + 1] ?? null : null;
  }

  get previousElementSibling(): MockElement | null {
    if (!this.parent) return null;
    const index = this.parent.children.indexOf(this);
    return index > 0 ? this.parent.children[index - 1] : null;
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = {
      defaultView: (globalThis as { window?: Window }).window ?? null,
    };
  }

  set className(value: string) {
    this.classList.clear();
    value.split(/\s+/).filter(Boolean).forEach((cls) => this.classList.add(cls));
  }

  get className(): string {
    return this.classList.toArray().join(' ');
  }

  get scrollHeight(): number {
    return this._scrollHeight;
  }

  set scrollHeight(value: number) {
    this._scrollHeight = value;
  }

  get clientHeight(): number {
    return this._clientHeight;
  }

  set clientHeight(value: number) {
    this._clientHeight = value;
  }

  get scrollTop(): number {
    return this._scrollTop;
  }

  set scrollTop(value: number) {
    this._scrollTop = value;
  }

  scrollTo(options: { top: number; behavior: string }): void {
    this.scrollToCalls.push(options);
    this._scrollTop = options.top;
  }

  appendChild(child: MockElement): MockElement {
    child.parent = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  contains(node: MockElement): boolean {
    if (node === this) return true;
    return this.children.some(child => child.contains(node));
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
    this.dispatchEvent({ type: 'focus' });
  }

  addEventListener(type: string, listener: Listener, _options?: any): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(event: any): void {
    const listeners = this.listeners[event.type] || [];
    for (const listener of listeners) {
      listener(event);
    }
  }

  click(): void {
    this.dispatchEvent({ type: 'click', stopPropagation: jest.fn(), preventDefault: jest.fn() });
  }

  empty(): void {
    this.children = [];
    this.textContent = '';
  }

  createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }): MockElement {
    return this.createEl('div', options);
  }

  createSpan(options?: { cls?: string; text?: string; attr?: Record<string, string> }): MockElement {
    return this.createEl('span', options);
  }

  setText(text: string): void {
    this.textContent = text;
  }

  createEl(
    tagName: string,
    options?: { cls?: string; text?: string; attr?: Record<string, string> }
  ): MockElement {
    const el = new MockElement(tagName);
    if (options?.cls) el.className = options.cls;
    if (options?.text) el.textContent = options.text;
    if (options?.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        el.setAttribute(key, value);
      }
    }
    this.appendChild(el);
    return el;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const matches: MockElement[] = [];
    const selectors = selector.split(',').map((part) => part.trim()).filter(Boolean);
    const matchesSelector = (el: MockElement, singleSelector: string): boolean => {
      if (singleSelector.startsWith('.')) {
        const className = singleSelector.slice(1);
        return el.classList.contains(className);
      }
      const attributeMatch = singleSelector.match(/^\[([^=\]]+)="([^"]+)"\]$/);
      if (attributeMatch) {
        return el.getAttribute(attributeMatch[1]) === attributeMatch[2];
      }
      return el.tagName.toLowerCase() === singleSelector.toLowerCase();
    };
    const traverse = (el: MockElement): void => {
      if (selectors.some((singleSelector) => matchesSelector(el, singleSelector))) {
        matches.push(el);
      }
      for (const child of el.children) {
        traverse(child);
      }
    };
    traverse(this);
    return matches;
  }
}

describe('NavigationSidebar', () => {
  let parentEl: MockElement;
  let messagesEl: MockElement;
  let sidebar: NavigationSidebar;
  let originalWindow: Window | undefined;
  let originalMutationObserver: typeof MutationObserver | undefined;
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let mutationCallback: MutationCallback | null;
  let resizeCallback: ResizeObserverCallback | null;

  beforeEach(() => {
    jest.useFakeTimers();
    originalWindow = (globalThis as { window?: Window }).window;
    originalMutationObserver = (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
    originalResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    mutationCallback = null;
    resizeCallback = null;
    Object.defineProperty(globalThis, 'window', {
      value: {
        requestAnimationFrame: (callback: FrameRequestCallback): number =>
          globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number,
        cancelAnimationFrame: (handle: number): void => {
          globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
        },
        setTimeout: (callback: () => void, timeout: number): number =>
          globalThis.setTimeout(callback, timeout) as unknown as number,
        clearTimeout: (handle: number): void => {
          globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
        },
      } as Window,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'MutationObserver', {
      value: class MockMutationObserver {
        constructor(callback: MutationCallback) {
          mutationCallback = callback;
        }

        observe(): void {}
        disconnect(): void {}
        takeRecords(): MutationRecord[] {
          return [];
        }
      } as unknown as typeof MutationObserver,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: class MockResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }

        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      } as unknown as typeof ResizeObserver,
      configurable: true,
    });
    parentEl = new MockElement('div');
    messagesEl = new MockElement('div');
    parentEl.appendChild(messagesEl);
  });

  afterEach(() => {
    sidebar?.destroy();
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
    if (originalMutationObserver === undefined) {
      delete (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
    } else {
      Object.defineProperty(globalThis, 'MutationObserver', {
        value: originalMutationObserver,
        configurable: true,
      });
    }
    if (originalResizeObserver === undefined) {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    } else {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        value: originalResizeObserver,
        configurable: true,
      });
    }
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should create container with correct class', () => {
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.claudian-nav-sidebar');
      expect(container).not.toBeNull();
    });

    it('should expose the outline track inside the sidebar container', () => {
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.claudian-nav-sidebar');
      const track = parentEl.querySelector('.claudian-nav-outline-track');
      expect(container).not.toBeNull();
      expect(track).not.toBeNull();
      expect(track?.getAttribute('aria-label')).toBe('Conversation outline');
    });

    it('should not render any navigation buttons', () => {
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const buttons = parentEl.querySelectorAll('.claudian-nav-btn');
      expect(buttons).toHaveLength(0);
    });
  });

  describe('visibility', () => {
    it('should be hidden when content does not overflow', () => {
      messagesEl.scrollHeight = 500;
      messagesEl.clientHeight = 500;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.claudian-nav-sidebar');
      expect(container!.classList.contains('visible')).toBe(false);
    });

    it('stays hidden for a scrollable transcript without outline entries', () => {
      messagesEl.scrollHeight = 1000;
      messagesEl.clientHeight = 500;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.claudian-nav-sidebar');
      expect(container!.classList.contains('visible')).toBe(false);
    });

    it('shows the rail and reserves a gutter when an outlined transcript overflows', () => {
      messagesEl.scrollHeight = 500;
      messagesEl.clientHeight = 500;
      const task = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
      task.offsetTop = 0;
      task.setAttribute('data-toc-title', 'First task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.claudian-nav-sidebar');
      expect(container!.classList.contains('visible')).toBe(false);

      // Simulate content growth
      messagesEl.scrollHeight = 1000;
      sidebar.updateVisibility();
      jest.advanceTimersByTime(16);

      expect(container!.classList.contains('visible')).toBe(true);
      expect(parentEl.classList.contains('claudian-has-nav-sidebar')).toBe(true);
    });

    it('should batch visibility updates until the next animation frame', () => {
      messagesEl.scrollHeight = 500;
      messagesEl.clientHeight = 500;
      const task = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
      task.offsetTop = 0;
      task.setAttribute('data-toc-title', 'First task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.claudian-nav-sidebar');
      messagesEl.scrollHeight = 1000;
      sidebar.updateVisibility();
      sidebar.updateVisibility();

      expect(container!.classList.contains('visible')).toBe(false);

      jest.advanceTimersByTime(16);

      expect(container!.classList.contains('visible')).toBe(true);
    });

    it('does not show the rail for a non-scrollable outlined transcript', () => {
      messagesEl.scrollHeight = 500;
      messagesEl.clientHeight = 500;
      const task = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
      task.offsetTop = 0;
      task.setAttribute('data-toc-title', 'First task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );

      expect(parentEl.querySelector('.claudian-nav-sidebar')!.classList.contains('visible')).toBe(false);
      expect(parentEl.classList.contains('claudian-has-nav-sidebar')).toBe(false);
    });

    it('shows the rail after a restored user message is discovered asynchronously', () => {
      messagesEl.scrollHeight = 1000;
      messagesEl.clientHeight = 500;
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );

      const restoredMessage = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-user',
      });
      restoredMessage.offsetTop = 200;
      restoredMessage.setAttribute('data-toc-title', 'Restored task');
      mutationCallback?.([
        {
          type: 'childList',
          target: messagesEl,
          addedNodes: [restoredMessage],
          removedNodes: [],
        } as unknown as MutationRecord,
      ], {} as MutationObserver);

      jest.advanceTimersByTime(80);

      expect(parentEl.querySelector('.claudian-nav-sidebar')!.classList.contains('visible')).toBe(true);
      expect(parentEl.classList.contains('claudian-has-nav-sidebar')).toBe(true);
    });

    it('re-evaluates rail visibility when a pane resize changes overflow', () => {
      const user = messagesEl.createDiv({ cls: 'claudian-message-user' });
      user.createDiv({ cls: 'claudian-message-content', text: 'Prompt after resize' });
      messagesEl.scrollHeight = 500;
      messagesEl.clientHeight = 500;
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );

      expect(parentEl.classList.contains('claudian-has-nav-sidebar')).toBe(false);

      messagesEl.clientHeight = 240;
      resizeCallback?.([], {} as ResizeObserver);
      jest.advanceTimersByTime(16);

      expect(parentEl.classList.contains('claudian-has-nav-sidebar')).toBe(true);
    });

    it('removes the rail gutter after the final outline entry is removed', () => {
      messagesEl.scrollHeight = 1000;
      messagesEl.clientHeight = 500;
      const userMessage = messagesEl.createDiv({
        cls: 'claudian-message claudian-message-user',
      });
      userMessage.offsetTop = 100;
      userMessage.setAttribute('data-toc-title', 'Only task');
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );
      expect(parentEl.classList.contains('claudian-has-nav-sidebar')).toBe(true);

      userMessage.remove();
      mutationCallback?.([
        {
          type: 'childList',
          target: messagesEl,
          addedNodes: [],
          removedNodes: [userMessage],
        } as unknown as MutationRecord,
      ], {} as MutationObserver);

      jest.advanceTimersByTime(80);

      expect(parentEl.querySelector('.claudian-nav-sidebar')!.classList.contains('visible')).toBe(false);
      expect(parentEl.classList.contains('claudian-has-nav-sidebar')).toBe(false);
    });
  });

  describe('floating conversation outline', () => {
    function addMessage(
      role: 'user' | 'assistant',
      offset: number,
      title?: string
    ): MockElement {
      const msg = messagesEl.createDiv({ cls: `claudian-message claudian-message-${role}` });
      msg.offsetTop = offset;
      if (title) msg.setAttribute('data-toc-title', title);
      return msg;
    }

    it('renders only user prompt markers, excluding assistant headings', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'Build a semantic search index');
      const assistant = addMessage('assistant', 180);
      const content = assistant.createDiv({ cls: 'claudian-message-content' });
      const textBlock = content.createDiv({ cls: 'claudian-text-block' });
      const heading = new MockElement('h2');
      heading.textContent = 'Index architecture';
      textBlock.appendChild(heading);

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const track = parentEl.querySelector('.claudian-nav-outline-track');
      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      expect(track).not.toBeNull();
      expect(track?.getAttribute('aria-label')).toBe('Conversation outline');
      expect(markers).toHaveLength(1);
      expect(markers[0].getAttribute('data-outline-kind')).toBe('prompt');
      expect(markers[0].getAttribute('data-outline-level')).toBe('1');
    });

    it('lays out markers in the flex track without per-marker position styles', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First task');
      addMessage('user', 180, 'Second task');
      addMessage('user', 360, 'Third task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      expect(markers).toHaveLength(3);
      // Markers are stacked via the track's flex gap; no percentage top is set.
      const tops = [0, 1, 2].map(i => markers[i].style['--claudian-outline-top']);
      expect(tops).toEqual([undefined, undefined, undefined]);
    });

    it('does not create outline entries for assistant messages', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      const assistant = addMessage('assistant', 180);
      const content = assistant.createDiv({ cls: 'claudian-message-content' });
      const textBlock = content.createDiv({ cls: 'claudian-text-block' });
      const heading = new MockElement('h2');
      heading.textContent = 'Index architecture';
      textBlock.appendChild(heading);

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      expect(markers).toHaveLength(0);
    });

    it('shows a prompt preview card with the assistant reply excerpt on marker hover', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'Build a semantic search index');
      const assistant = addMessage('assistant', 180);
      const assistantContent = assistant.createDiv({ cls: 'claudian-message-content' });
      assistantContent.createDiv({
        cls: 'claudian-text-block',
        text: 'Here is the semantic search index for the vault notes.',
      });

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const marker = parentEl.querySelector('.claudian-nav-outline-marker')!;
      marker.dispatchEvent({ type: 'mouseenter' });

      const preview = parentEl.querySelector('.claudian-nav-outline-preview');
      expect(preview).not.toBeNull();
      expect(marker.getAttribute('aria-describedby')).toBe(preview?.getAttribute('id'));
      expect(parentEl.querySelector('.claudian-nav-outline-preview-title')?.textContent)
        .toBe('Build a semantic search index');
      expect(parentEl.querySelector('.claudian-nav-outline-preview-excerpt')?.textContent)
        .toContain('for the vault notes');

      marker.dispatchEvent({ type: 'mouseleave' });
      expect(marker.getAttribute('aria-describedby')).toBeNull();
    });

    it('does not assign a queued turn response to an earlier unanswered prompt', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First queued task');
      addMessage('user', 140, 'Second queued task');
      const assistant = addMessage('assistant', 280);
      const assistantContent = assistant.createDiv({ cls: 'claudian-message-content' });
      assistantContent.createDiv({
        cls: 'claudian-text-block',
        text: 'This answer belongs only to the second task.',
      });

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      markers[0].dispatchEvent({ type: 'mouseenter' });
      expect(parentEl.querySelector('.claudian-nav-outline-preview-excerpt')).toBeNull();

      markers[1].dispatchEvent({ type: 'mouseenter' });
      expect(parentEl.querySelector('.claudian-nav-outline-preview-excerpt')?.textContent)
        .toContain('belongs only to the second task');
    });

    it('refreshes the prompt preview when its assistant reply streams in', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'Build a semantic search index');
      const assistant = addMessage('assistant', 180);
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );

      const content = assistant.createDiv({ cls: 'claudian-message-content' });
      const textBlock = content.createDiv({
        cls: 'claudian-text-block',
        text: 'Use hybrid retrieval with semantic reranking.',
      });
      mutationCallback?.([
        {
          type: 'childList',
          target: assistant,
          addedNodes: [content, textBlock],
          removedNodes: [],
        } as unknown as MutationRecord,
      ], {} as MutationObserver);
      jest.advanceTimersByTime(80);

      parentEl.querySelector('.claudian-nav-outline-marker')!
        .dispatchEvent({ type: 'mouseenter' });
      expect(parentEl.querySelector('.claudian-nav-outline-preview-excerpt')?.textContent)
        .toContain('semantic reranking');
    });

    it('scrolls directly to a selected user prompt', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First task');
      addMessage('user', 400, 'Second task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      markers[1].click();

      const lastCall = messagesEl.scrollToCalls[messagesEl.scrollToCalls.length - 1];
      expect(lastCall.top).toBe(390);
      expect(lastCall.behavior).toBe('smooth');
    });

    it('highlights the last outline marker above the reading line', () => {
      messagesEl.scrollHeight = 2200;
      messagesEl.clientHeight = 600;
      addMessage('user', 0, 'First task');
      addMessage('user', 500, 'Second task');
      addMessage('user', 1100, 'Third task');
      messagesEl.scrollTop = 520;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );
      messagesEl.dispatchEvent({ type: 'scroll' });
      jest.advanceTimersByTime(16);

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      expect(markers[0].classList.contains('is-active')).toBe(false);
      expect(markers[1].classList.contains('is-active')).toBe(true);
      expect(markers[2].classList.contains('is-active')).toBe(false);
    });

    it('finds the active entry with logarithmic layout reads on long conversations', () => {
      messagesEl.scrollHeight = 8000;
      messagesEl.clientHeight = 500;
      const targets = Array.from({ length: 64 }, (_, index) => (
        addMessage('user', index * 100, `Task ${index + 1}`)
      ));
      const containerRect = jest.fn(() => ({ top: 0 } as DOMRect));
      (messagesEl as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
        containerRect;
      const targetRects = targets.map((target) => {
        const rect = jest.fn(() => ({ top: target.offsetTop - messagesEl.scrollTop } as DOMRect));
        (target as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = rect;
        return rect;
      });

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );
      containerRect.mockClear();
      targetRects.forEach(rect => rect.mockClear());

      messagesEl.scrollTop = 5700;
      messagesEl.dispatchEvent({ type: 'scroll' });
      jest.advanceTimersByTime(16);

      const targetReadCount = targetRects.reduce((sum, rect) => sum + rect.mock.calls.length, 0);
      expect(containerRect).toHaveBeenCalledTimes(1);
      expect(targetReadCount).toBeLessThanOrEqual(7);
    });

    it('marks the correct marker as active based on scroll position', () => {
      messagesEl.scrollHeight = 3000;
      messagesEl.clientHeight = 400;
      const targets = Array.from({ length: 20 }, (_, index) => (
        addMessage('user', index * 100, `Task ${index + 1}`)
      ));

      (messagesEl as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
        () => ({ top: 0, height: 400 } as DOMRect);
      targets.forEach((target) => {
        (target as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
          () => ({ top: target.offsetTop - messagesEl.scrollTop, height: 20 } as DOMRect);
      });

      messagesEl.scrollTop = 1700;
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );
      jest.advanceTimersByTime(16);

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      const activeMarker = Array.from(markers).find(m => m.classList.contains('is-active'));
      expect(activeMarker).not.toBeNull();
    });

    it('updates the active marker when scroll position changes', () => {
      messagesEl.scrollHeight = 3000;
      messagesEl.clientHeight = 400;
      const targets = Array.from({ length: 20 }, (_, index) => (
        addMessage('user', index * 100, `Task ${index + 1}`)
      ));

      (messagesEl as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
        () => ({ top: 0, height: 400 } as DOMRect);
      targets.forEach((target) => {
        (target as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
          () => ({ top: target.offsetTop - messagesEl.scrollTop, height: 20 } as DOMRect);
      });

      messagesEl.scrollTop = 500;
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );
      jest.advanceTimersByTime(16);

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      const firstActive = Array.from(markers).findIndex(m => m.classList.contains('is-active'));

      messagesEl.scrollTop = 1800;
      messagesEl.dispatchEvent({ type: 'scroll' });
      jest.advanceTimersByTime(16);

      const secondActive = Array.from(markers).findIndex(m => m.classList.contains('is-active'));
      expect(secondActive).toBeGreaterThan(firstActive);
    });

    it('does not add markers when streamed assistant headings appear', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First task');
      const assistant = addMessage('assistant', 180);

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );
      expect(parentEl.querySelectorAll('.claudian-nav-outline-marker')).toHaveLength(1);

      const content = assistant.createDiv({ cls: 'claudian-message-content' });
      const textBlock = content.createDiv({ cls: 'claudian-text-block' });
      const heading = new MockElement('h2');
      heading.textContent = 'Streamed heading';
      textBlock.appendChild(heading);
      mutationCallback?.([
        {
          type: 'childList',
          target: assistant,
          addedNodes: [heading],
          removedNodes: [],
        } as unknown as MutationRecord,
      ], {} as MutationObserver);
      jest.advanceTimersByTime(80);

      expect(parentEl.querySelectorAll('.claudian-nav-outline-marker')).toHaveLength(1);
    });

    it('keeps marker focus when a new user message extends the outline', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First task');
      addMessage('user', 180, 'Second task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );
      const originalMarkers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      originalMarkers[1].focus();

      const newMsg = addMessage('user', 400, 'Third task');
      mutationCallback?.([
        {
          type: 'childList',
          target: messagesEl,
          addedNodes: [newMsg],
          removedNodes: [],
        } as unknown as MutationRecord,
      ], {} as MutationObserver);
      jest.advanceTimersByTime(80);

      const refreshedMarkers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      expect(refreshedMarkers).toHaveLength(3);
      expect(refreshedMarkers[1]).not.toBe(originalMarkers[1]);
      expect(parentEl.ownerDocument.activeElement).toBe(refreshedMarkers[1]);
    });

    it('collapses transient outline surfaces when its tab is deactivated', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );
      parentEl.querySelector('.claudian-nav-outline-marker')!
        .dispatchEvent({ type: 'mouseenter' });

      sidebar.collapse();

      expect(parentEl.querySelector('.claudian-nav-outline-preview')).toBeNull();
    });

    it('numbers each preview badge by its index in the rail', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First task');
      addMessage('user', 600, 'Second task');
      addMessage('user', 1200, 'Third task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      markers[1].dispatchEvent({ type: 'mouseenter' });

      const badge = parentEl.querySelector('.claudian-nav-outline-preview-badge');
      expect(badge?.textContent).toBe('Q2');
    });

    it('moves focus to the next marker when ArrowDown is pressed', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First task');
      addMessage('user', 600, 'Second task');
      addMessage('user', 1200, 'Third task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      markers[0].focus();
      markers[0].dispatchEvent({
        type: 'keydown',
        key: 'ArrowDown',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });

      expect(parentEl.ownerDocument.activeElement).toBe(markers[1]);
    });

    it('moves focus to the previous marker when ArrowUp is pressed', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First task');
      addMessage('user', 600, 'Second task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      markers[1].focus();
      markers[1].dispatchEvent({
        type: 'keydown',
        key: 'ArrowUp',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });

      expect(parentEl.ownerDocument.activeElement).toBe(markers[0]);
    });

    it('Home and End jump to the first and last markers', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      addMessage('user', 0, 'First task');
      addMessage('user', 600, 'Middle task');
      addMessage('user', 1200, 'Last task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const container = parentEl.querySelector('.claudian-nav-sidebar')!;
      container.dispatchEvent({
        type: 'keydown',
        key: 'End',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      expect(parentEl.ownerDocument.activeElement).toBe(markers[markers.length - 1]);

      container.dispatchEvent({
        type: 'keydown',
        key: 'Home',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
      expect(parentEl.ownerDocument.activeElement).toBe(markers[0]);
    });
  });

  describe('sidebar visibility', () => {
    function isSidebarVisible(): boolean {
      const container = parentEl.querySelector('.claudian-nav-sidebar');
      return container?.classList.contains('visible') ?? false;
    }

    it('shows the sidebar when content overflows and entries exist', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      const msg = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
      msg.setAttribute('data-toc-title', 'Task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      expect(isSidebarVisible()).toBe(true);
    });

    it('hides the sidebar when content does not overflow', () => {
      messagesEl.scrollHeight = 400;
      messagesEl.clientHeight = 500;
      const msg = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
      msg.setAttribute('data-toc-title', 'Task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      expect(isSidebarVisible()).toBe(false);
    });

    it('hides the sidebar when there are no outline entries', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      expect(isSidebarVisible()).toBe(false);
    });

    it('marks the active entry based on scroll position', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      const msg = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
      msg.offsetTop = 200;
      msg.setAttribute('data-toc-title', 'Active task');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      const markers = parentEl.querySelectorAll('.claudian-nav-outline-marker');
      expect(markers[0]?.classList.contains('is-active')).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should remove container from DOM', () => {
      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement
      );

      expect(parentEl.querySelector('.claudian-nav-sidebar')).not.toBeNull();

      sidebar.destroy();

      expect(parentEl.querySelector('.claudian-nav-sidebar')).toBeNull();
    });
  });

  describe('teardown safety', () => {
    it('ignores a queued mutation observer callback after destruction', () => {
      messagesEl.scrollHeight = 2000;
      messagesEl.clientHeight = 500;
      const userMessage = messagesEl.createDiv({ cls: 'claudian-message claudian-message-user' });
      userMessage.offsetTop = 0;
      userMessage.setAttribute('data-toc-title', 'Prompt before close');

      sidebar = new NavigationSidebar(
        parentEl as unknown as HTMLElement,
        messagesEl as unknown as HTMLElement,
      );
      expect(parentEl.classList.contains('claudian-has-nav-sidebar')).toBe(true);

      sidebar.destroy();
      mutationCallback?.([
        {
          type: 'attributes',
          target: userMessage,
          attributeName: 'data-toc-title',
        } as unknown as MutationRecord,
      ], {} as MutationObserver);

      jest.advanceTimersByTime(100);
      expect(parentEl.classList.contains('claudian-has-nav-sidebar')).toBe(false);
      expect(parentEl.querySelector('.claudian-nav-sidebar')).toBeNull();
    });
  });
});
