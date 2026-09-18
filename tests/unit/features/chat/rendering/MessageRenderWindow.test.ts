import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import type { ChatMessage } from '@/core/types';
import {
  INITIAL_WINDOW_SIZE,
  MAX_WINDOW_SIZE,
  MessageRenderWindow,
} from '@/features/chat/rendering/MessageRenderWindow';

jest.mock('@/utils/imageEmbed', () => ({
  replaceImageEmbedsWithHtml: jest.fn().mockImplementation((md: string) => md),
}));

function buildMessages(count: number, prefix = 'm'): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    messages.push({
      id: `${prefix}-${i}`,
      role,
      content: role === 'user' ? `question ${i}` : `answer ${i}`,
      timestamp: i,
      ...(role === 'assistant'
        ? { contentBlocks: [{ type: 'text', content: `answer ${i}` }] as ChatMessage['contentBlocks'] }
        : {}),
    });
  }
  return messages;
}

interface WindowHarness {
  window: MessageRenderWindow;
  messagesEl: MockElement;
  released: string[];
  renderedIds: string[];
}

function createHarness(): WindowHarness {
  const messagesEl = createMockEl();
  const released: string[] = [];
  const renderedIds: string[] = [];
  const renderWindow = new MessageRenderWindow({
    renderStoredMessage: (msg) => {
      renderedIds.push(msg.id);
      const node = createMockEl();
      node.setAttribute('data-message-id', msg.id);
      return [node];
    },
    releaseStoredNodes: (_nodes, messageId) => {
      released.push(messageId);
    },
  });
  renderWindow.setContainer(messagesEl as unknown as HTMLElement);
  return { window: renderWindow, messagesEl, released, renderedIds };
}

describe('MessageRenderWindow', () => {
  // ============================================
  // First paint window
  // ============================================

  it('renders only the most recent 40 entries on first paint of a 3000-message history', () => {
    const { window, messagesEl } = createHarness();
    const messages = buildMessages(3000);

    window.reset(messages);

    expect(window.renderedCount).toBe(INITIAL_WINDOW_SIZE);
    expect(window.firstRenderedIndex).toBe(3000 - INITIAL_WINDOW_SIZE);
    expect(window.lastRenderedIndex).toBe(2999);
    expect(window.windowStartIndex).toBe(3000 - INITIAL_WINDOW_SIZE);
    expect(window.windowEndIndex).toBe(3000);
    expect(messagesEl.querySelectorAll('[data-message-id]')).toHaveLength(INITIAL_WINDOW_SIZE);
  });

  it('renders the whole history when it fits within the initial window', () => {
    const { window, messagesEl } = createHarness();
    const messages = buildMessages(12);

    window.reset(messages);

    expect(window.renderedCount).toBe(12);
    expect(window.firstRenderedIndex).toBe(0);
    expect(messagesEl.querySelectorAll('[data-message-id]')).toHaveLength(12);
  });

  it('does not reuse the previous conversation window when reset with different messages', () => {
    const { window, messagesEl, released, renderedIds } = createHarness();

    window.reset(buildMessages(3000, 'a'));
    const staleNode = messagesEl.querySelector('[data-message-id="a-2960"]');
    const removeSpy = staleNode ? jest.spyOn(staleNode, 'remove') : null;

    window.reset(buildMessages(10, 'b'));

    expect(window.renderedCount).toBe(10);
    expect(window.firstRenderedIndex).toBe(0);
    expect(messagesEl.querySelector('[data-message-id="b-9"]')).not.toBeNull();
    // Every node from the previous conversation was released and detached.
    expect(released.filter((id) => id.startsWith('a-'))).toHaveLength(40);
    expect(removeSpy).toHaveBeenCalled();
    expect(renderedIds.some((id) => id.startsWith('b-'))).toBe(true);
  });

  // ============================================
  // Loading older history
  // ============================================

  it('prepends 40 older entries when the user scrolls to the top', () => {
    const { window, messagesEl } = createHarness();
    window.reset(buildMessages(3000));

    messagesEl.scrollTop = 0;
    window.handleScroll();

    expect(window.renderedCount).toBe(2 * INITIAL_WINDOW_SIZE);
    expect(window.firstRenderedIndex).toBe(3000 - 2 * INITIAL_WINDOW_SIZE);
    expect(window.windowEndIndex).toBe(3000);
  });

  it('keeps the scroll anchor of already-rendered content stable across a load-older shift', () => {
    const { window, messagesEl } = createHarness();
    window.reset(buildMessages(3000));

    // Simulate real layout: the container reports its height before the prepend
    // (1000) and a grown height after the older messages were inserted (1400).
    let scrollHeightReads = 0;
    Object.defineProperty(messagesEl, 'scrollHeight', {
      get: () => (++scrollHeightReads === 1 ? 1000 : 1400),
      configurable: true,
    });
    messagesEl.scrollTop = 0;

    window.handleScroll();

    // The content the user was looking at moved down by the prepended height
    // (400), so scrollTop must follow it instead of showing the new top.
    expect(messagesEl.scrollTop).toBe(400);
  });

  it('converges on at most 120 historical entries while paging upward', () => {
    const { window } = createHarness();
    window.reset(buildMessages(3000));

    let guard = 0;
    while (window.windowStartIndex > 0 && guard < 200) {
      window.loadOlder();
      guard++;
      expect(window.renderedCount).toBeLessThanOrEqual(MAX_WINDOW_SIZE);
    }

    expect(window.windowStartIndex).toBe(0);
    expect(window.renderedCount).toBe(MAX_WINDOW_SIZE);
    expect(window.firstRenderedIndex).toBe(0);
    // Sliding the window upward releases the newest entries it drops.
    expect(window.windowEndIndex).toBe(MAX_WINDOW_SIZE);
  });

  it('stops loading older history once the start of the conversation is reached', () => {
    const { window } = createHarness();
    window.reset(buildMessages(60));

    window.loadOlder();
    expect(window.renderedCount).toBe(60);
    expect(window.windowStartIndex).toBe(0);

    expect(window.loadOlder()).toBe(0);
    expect(window.renderedCount).toBe(60);
  });

  // ============================================
  // Loading newer history
  // ============================================

  it('loads newer entries after the window was switched away from the newest end', () => {
    const { window } = createHarness();
    window.reset(buildMessages(3000));
    window.ensureMessageRendered('m-10');
    expect(window.windowEndIndex).toBe(INITIAL_WINDOW_SIZE);

    const loaded = window.loadNewer();

    expect(loaded).toBe(INITIAL_WINDOW_SIZE);
    expect(window.windowEndIndex).toBe(2 * INITIAL_WINDOW_SIZE);
    expect(window.lastRenderedIndex).toBe(2 * INITIAL_WINDOW_SIZE - 1);
  });

  it('slides the window downward within the cap and keeps the scroll anchor stable', () => {
    const { window, messagesEl } = createHarness();
    window.reset(buildMessages(3000));
    window.ensureMessageRendered('m-1000');
    window.loadOlder();
    window.loadOlder();
    // Window is now 900..1020 with 120 entries.
    expect(window.renderedCount).toBe(MAX_WINDOW_SIZE);

    let scrollHeightReads = 0;
    Object.defineProperty(messagesEl, 'scrollHeight', {
      get: () => (++scrollHeightReads === 1 ? 1000 : 600),
      configurable: true,
    });
    messagesEl.scrollTop = 500;

    window.loadNewer();

    // Appending newer content does not move the view; trimming the oldest
    // entries removes 400px above the viewport, so scrollTop follows by -400.
    expect(messagesEl.scrollTop).toBe(100);
    expect(window.renderedCount).toBe(MAX_WINDOW_SIZE);
    expect(window.firstRenderedIndex).toBe(940);
    expect(window.lastRenderedIndex).toBe(1059);
  });

  // ============================================
  // Message targeting
  // ============================================

  it('switches the window so a targeted early message becomes rendered', () => {
    const { window, messagesEl, released } = createHarness();
    window.reset(buildMessages(3000));

    const node = window.ensureMessageRendered('m-10');

    expect(node).not.toBeNull();
    expect(node?.getAttribute('data-message-id')).toBe('m-10');
    expect(messagesEl.querySelector('[data-message-id="m-10"]')).not.toBeNull();
    expect(window.renderedCount).toBe(INITIAL_WINDOW_SIZE);
    // The page that was dropped was released, not merely detached.
    expect(released).toContain('m-2999');
  });

  it('keeps the current window when the target message is already rendered', () => {
    const { window, released } = createHarness();
    window.reset(buildMessages(3000));
    const countBefore = window.renderedCount;
    const startBefore = window.windowStartIndex;

    const node = window.ensureMessageRendered('m-2990');

    expect(node?.getAttribute('data-message-id')).toBe('m-2990');
    expect(window.renderedCount).toBe(countBefore);
    expect(window.windowStartIndex).toBe(startBefore);
    expect(released).toHaveLength(0);
  });

  it('preserves the browsing budget when switching the window for a target', () => {
    const { window } = createHarness();
    window.reset(buildMessages(3000));
    window.loadOlder();
    window.loadOlder();
    expect(window.renderedCount).toBe(MAX_WINDOW_SIZE);

    window.ensureMessageRendered('m-1000');

    expect(window.renderedCount).toBe(MAX_WINDOW_SIZE);
    expect(window.windowStartIndex).toBeLessThanOrEqual(1000);
    expect(window.windowEndIndex).toBeGreaterThanOrEqual(1000);
  });

  it('returns null when the targeted message is not part of the rendered conversation', () => {
    const { window } = createHarness();
    window.reset(buildMessages(50));

    expect(window.ensureMessageRendered('missing-id')).toBeNull();
  });

  // ============================================
  // Resource release
  // ============================================

  it('captures collapse state when discarding a node and restores it on re-entry', () => {
    const messagesEl = createMockEl();
    const collapseStateByMessage = new Map<string, boolean[]>();
    const buildCollapsibleNode = (messageId: string): MockElement => {
      const node = createMockEl();
      node.setAttribute('data-message-id', messageId);
      const header = createMockEl();
      header.setAttribute('aria-expanded', 'false');
      header.addEventListener('click', () => {
        const expanded = header.getAttribute('aria-expanded') === 'true';
        header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      });
      node.appendChild(header);
      return node;
    };

    const renderWindow = new MessageRenderWindow({
      renderStoredMessage: (msg) => [buildCollapsibleNode(msg.id) as unknown as HTMLElement],
      releaseStoredNodes: (nodes, messageId) => {
        const states: boolean[] = [];
        for (const node of nodes) {
          for (const header of node.querySelectorAll('[aria-expanded]')) {
            states.push(header.getAttribute('aria-expanded') === 'true');
          }
        }
        collapseStateByMessage.set(messageId, states);
      },
    });
    renderWindow.setContainer(messagesEl as unknown as HTMLElement);
    const messages = buildMessages(3000);

    renderWindow.reset(messages);

    // The user expands the tool header of a rendered message.
    const renderedNode = messagesEl.querySelector('[data-message-id="m-2975"]');
    expect(renderedNode).not.toBeNull();
    renderedNode!.querySelector('[aria-expanded]')!.click();
    expect(
      renderedNode!.querySelector('[aria-expanded]')!.getAttribute('aria-expanded')
    ).toBe('true');

    // Navigating elsewhere discards the node; its collapse state is captured.
    renderWindow.ensureMessageRendered('m-10');
    expect(collapseStateByMessage.get('m-2975')).toEqual([true]);

    // Coming back restores the recorded state without user interaction.
    renderWindow.ensureMessageRendered('m-2975');
    const restoredNode = messagesEl.querySelector('[data-message-id="m-2975"]');
    expect(restoredNode).not.toBeNull();
    expect(
      restoredNode!.querySelector('[aria-expanded]')!.getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('forgets bookkeeping for messages removed outside the window', () => {
    const { window } = createHarness();
    window.reset(buildMessages(60));
    expect(window.renderedCount).toBe(INITIAL_WINDOW_SIZE);

    window.forget('m-59');

    expect(window.renderedCount).toBe(INITIAL_WINDOW_SIZE - 1);
    expect(window.isRendered('m-59')).toBe(false);
  });

  it('detaches its scroll listener on dispose', () => {
    const { window, messagesEl } = createHarness();
    window.reset(buildMessages(3000));

    window.dispose();
    messagesEl.scrollTop = 0;
    messagesEl.dispatchEvent('scroll');

    expect(window.renderedCount).toBe(INITIAL_WINDOW_SIZE);
  });
});
