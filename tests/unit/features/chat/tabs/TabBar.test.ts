import { createMockEl } from '@test/helpers/mockElement';

import { TabBar, type TabBarCallbacks } from '@/features/chat/tabs/TabBar';
import type { TabBarItem } from '@/features/chat/tabs/types';

// Helper to create mock callbacks
function createMockCallbacks(): TabBarCallbacks {
  return {
    onTabClick: jest.fn(),
    onTabClose: jest.fn(),
    onNewTab: jest.fn(),
  };
}

// Helper to create tab bar items
function createTabBarItem(overrides: Partial<TabBarItem> = {}): TabBarItem {
  return {
    id: 'tab-1',
    index: 1,
    title: 'Test Tab',
    providerId: 'claude',
    isActive: false,
    isStreaming: false,
    needsAttention: false,
    canClose: true,
    ...overrides,
  };
}

describe('TabBar', () => {
  describe('constructor', () => {
    it('should add tab badges class to container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();

      new TabBar(containerEl, callbacks);

      expect(containerEl._classList.has('claudian-plus-tab-badges')).toBe(true);
    });
  });

  describe('update', () => {
    it('should clear existing badges before rendering', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      // First update
      tabBar.update([createTabBarItem()]);
      expect(containerEl._children.length).toBe(1);

      // Second update should clear first
      tabBar.update([createTabBarItem(), createTabBarItem({ id: 'tab-2', index: 2 })]);
      expect(containerEl._children.length).toBe(2);
    });

    it('should render badge for each tab item', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([
        createTabBarItem({ id: 'tab-1', index: 1 }),
        createTabBarItem({ id: 'tab-2', index: 2 }),
        createTabBarItem({ id: 'tab-3', index: 3 }),
      ]);

      expect(containerEl._children.length).toBe(3);
    });

    it('should render empty when no items', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([]);

      expect(containerEl._children.length).toBe(0);
    });
  });

  describe('badge rendering', () => {
    it('should display the conversation title as text', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ index: 5, title: 'Research notes' })]);

      expect(containerEl._children[0].textContent).toBe('Research notes');
      expect(containerEl._children[0].tagName).toBe('BUTTON');
      expect(containerEl._children[0].getAttribute('aria-selected')).toBe('false');
    });

    it('should use aria-label as the single tab title tooltip source', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ title: 'My Conversation' })]);

      expect(containerEl._children[0].getAttribute('aria-label')).toBe('My Conversation');
      expect(containerEl._children[0].getAttribute('title')).toBeNull();
    });

    it('should set a provider attribute for per-tab streaming colors', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ providerId: 'opencode' })]);

      expect(containerEl._children[0].getAttribute('data-provider')).toBe('opencode');
    });

    it('should not use double click to change the visible title', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ index: 2, title: 'My Conversation' })]);

      const badge = containerEl._children[0];
      expect(badge.textContent).toBe('My Conversation');
      expect(badge._eventListeners.has('dblclick')).toBe(false);
    });

    it('should render restored expanded title state', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.setExpandedTitleTabIds(['tab-1']);
      tabBar.update([createTabBarItem({ id: 'tab-1', index: 1, title: 'Restored Title' })]);

      expect(containerEl._children[0].textContent).toBe('Restored Title');
      expect(containerEl._children[0].getAttribute('data-title-expanded')).toBeNull();
      expect(tabBar.getExpandedTitleTabIds()).toEqual(['tab-1']);
    });

    it('should truncate long title labels with a literal ellipsis suffix', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);
      const title = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

      tabBar.update([createTabBarItem({ title })]);

      expect(containerEl._children[0].textContent).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ012...');
      expect(containerEl._children[0].textContent.endsWith('...')).toBe(true);
    });

    it('should update the visible title across tab bar updates', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'tab-1', index: 1, title: 'First Title' })]);
      tabBar.update([createTabBarItem({ id: 'tab-1', index: 1, title: 'Renamed Title' })]);

      expect(containerEl._children[0].textContent).toBe('Renamed Title');
    });

    it('should preserve horizontal scroll position across tab bar updates', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([
        createTabBarItem({ id: 'tab-1', index: 1 }),
        createTabBarItem({ id: 'tab-2', index: 2 }),
      ]);
      containerEl.scrollLeft = 72;

      tabBar.update([
        createTabBarItem({ id: 'tab-1', index: 1 }),
        createTabBarItem({ id: 'tab-2', index: 2, isActive: true }),
      ]);

      expect(containerEl.scrollLeft).toBe(72);
    });

    it('should restore the last known scroll position when live DOM scroll resets before update', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([
        createTabBarItem({ id: 'tab-1', index: 1 }),
        createTabBarItem({ id: 'tab-2', index: 2 }),
        createTabBarItem({ id: 'tab-3', index: 3 }),
      ]);
      containerEl.scrollLeft = 96;
      containerEl.dispatchEvent('scroll');
      containerEl.scrollLeft = 0;

      tabBar.update([
        createTabBarItem({ id: 'tab-1', index: 1 }),
        createTabBarItem({ id: 'tab-2', index: 2 }),
        createTabBarItem({ id: 'tab-3', index: 3, isActive: true }),
      ]);

      expect(containerEl.scrollLeft).toBe(96);
    });
  });

  describe('badge state classes', () => {
    it('should apply idle class for inactive tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: false, isStreaming: false, needsAttention: false })]);

      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-idle')).toBe(true);
    });

    it('should apply active class for active tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true })]);

      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-active')).toBe(true);
    });

    it('should apply streaming class for streaming tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isStreaming: true })]);

      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-streaming')).toBe(true);
    });

    it('should apply attention class for tab needing attention', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-attention')).toBe(true);
    });

    it('should prioritize active over attention', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true, needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-active')).toBe(true);
      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-attention')).toBe(false);
    });

    it('should prioritize attention over streaming', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isStreaming: true, needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-attention')).toBe(true);
      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-streaming')).toBe(false);
    });

    it('should prioritize active over streaming', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true, isStreaming: true })]);

      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-active')).toBe(true);
      expect(containerEl._children[0]._classList.has('claudian-plus-tab-badge-streaming')).toBe(false);
    });
  });

  describe('badge interactions', () => {
    it('should call onTabClick when badge is clicked', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'clicked-tab' })]);

      // Simulate click
      containerEl._children[0].dispatchEvent('click');

      expect(callbacks.onTabClick).toHaveBeenCalledWith('clicked-tab');
    });

    it('should leave right-click available for a context menu', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'closeable-tab', canClose: true })]);

      expect(containerEl._children[0]._eventListeners.has('contextmenu')).toBe(false);
      expect(callbacks.onTabClose).not.toHaveBeenCalled();
    });

    it('should not register contextmenu handler when canClose is false', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'uncloseable-tab', canClose: false })]);

      // Check that contextmenu handler was not registered
      expect(containerEl._children[0]._eventListeners.has('contextmenu')).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should empty container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem(), createTabBarItem({ id: 'tab-2', index: 2 })]);
      expect(containerEl._children.length).toBe(2);

      tabBar.destroy();

      expect(containerEl._children.length).toBe(0);
    });

    it('should remove tab badges class from container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      expect(containerEl._classList.has('claudian-plus-tab-badges')).toBe(true);

      tabBar.destroy();

      expect(containerEl._classList.has('claudian-plus-tab-badges')).toBe(false);
    });
  });
});
