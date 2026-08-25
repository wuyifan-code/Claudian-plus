import { createMockEl } from '@test/helpers/mockElement';

import { TabBar, type TabBarCallbacks } from '@/features/chat/tabs/TabBar';
import type { TabBarItem } from '@/features/chat/tabs/types';

function createMockCallbacks(overrides: Partial<TabBarCallbacks> = {}): TabBarCallbacks {
  return {
    onTabClick: jest.fn(),
    onTabClose: jest.fn(),
    onNewTab: jest.fn(),
    onTabReorder: jest.fn(),
    ...overrides,
  };
}

function createTabBarItem(overrides: Partial<TabBarItem> = {}): TabBarItem {
  return {
    id: 'tab-1',
    index: 1,
    title: 'Test Tab 1',
    providerId: 'claude',
    isActive: false,
    isStreaming: false,
    needsAttention: false,
    canClose: true,
    ...overrides,
  };
}

describe('TabBar interactions', () => {
  it('closes tab on middle-click (auxclick with button 1) without calling onTabClick', () => {
    const containerEl = createMockEl();
    const callbacks = createMockCallbacks();
    const tabBar = new TabBar(containerEl as any, callbacks);

    tabBar.update([
      createTabBarItem({ id: 'tab-1', index: 1, canClose: true }),
      createTabBarItem({ id: 'tab-2', index: 2, canClose: true }),
    ]);

    const badgeEl = containerEl.querySelector('.claudian-plus-tab-badge');
    expect(badgeEl).not.toBeNull();

    const auxEvent = {
      type: 'auxclick',
      button: 1,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    badgeEl?.dispatchEvent(auxEvent);

    expect(callbacks.onTabClose).toHaveBeenCalledWith('tab-1');
    expect(callbacks.onTabClick).not.toHaveBeenCalled();
    expect(auxEvent.preventDefault).toHaveBeenCalled();
  });

  it('does not close on middle-click when canClose is false', () => {
    const containerEl = createMockEl();
    const callbacks = createMockCallbacks();
    const tabBar = new TabBar(containerEl as any, callbacks);

    tabBar.update([
      createTabBarItem({ id: 'tab-1', index: 1, canClose: false }),
    ]);

    const badgeEl = containerEl.querySelector('.claudian-plus-tab-badge');
    const auxEvent = {
      type: 'auxclick',
      button: 1,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    badgeEl?.dispatchEvent(auxEvent);

    expect(callbacks.onTabClose).not.toHaveBeenCalled();
  });

  it('triggers onTabClick on regular click without drag', () => {
    const containerEl = createMockEl();
    const callbacks = createMockCallbacks();
    const tabBar = new TabBar(containerEl as any, callbacks);

    tabBar.update([createTabBarItem({ id: 'tab-1', index: 1 })]);

    const badgeEl = containerEl.querySelector('.claudian-plus-tab-badge');
    badgeEl?.dispatchEvent({ type: 'click', button: 0 });

    expect(callbacks.onTabClick).toHaveBeenCalledWith('tab-1');
  });

  it('emits onTabReorder on pointer drag and drop across badges', () => {
    const containerEl = createMockEl();
    const callbacks = createMockCallbacks();
    const tabBar = new TabBar(containerEl as any, callbacks);

    tabBar.update([
      createTabBarItem({ id: 'tab-1', index: 1 }),
      createTabBarItem({ id: 'tab-2', index: 2 }),
      createTabBarItem({ id: 'tab-3', index: 3 }),
    ]);

    const badges = containerEl.querySelectorAll('.claudian-plus-tab-badge');
    const badge1 = badges[0];
    const badge2 = badges[1];
    const badge3 = badges[2];

    badge1.getBoundingClientRect = () => ({ left: 0, right: 30, top: 0, bottom: 20, width: 30, height: 20, x: 0, y: 0, toJSON: () => {} });
    badge2.getBoundingClientRect = () => ({ left: 30, right: 60, top: 0, bottom: 20, width: 30, height: 20, x: 30, y: 0, toJSON: () => {} });
    badge3.getBoundingClientRect = () => ({ left: 60, right: 90, top: 0, bottom: 20, width: 30, height: 20, x: 60, y: 0, toJSON: () => {} });

    // Pointer down on tab 1
    badge1.dispatchEvent({
      type: 'pointerdown',
      button: 0,
      clientX: 10,
      clientY: 10,
      target: badge1,
      currentTarget: badge1,
      setPointerCapture: jest.fn(),
    });

    // Pointer move past 6px threshold to x=45 (badge2 area)
    badge1.dispatchEvent({
      type: 'pointermove',
      clientX: 45,
      clientY: 10,
      target: badge2,
    });

    // Pointer up over badge 2
    badge1.dispatchEvent({
      type: 'pointerup',
      clientX: 45,
      clientY: 10,
      target: badge2,
      releasePointerCapture: jest.fn(),
    });

    expect(callbacks.onTabReorder).toHaveBeenCalledWith('tab-1', 1);
  });
});
