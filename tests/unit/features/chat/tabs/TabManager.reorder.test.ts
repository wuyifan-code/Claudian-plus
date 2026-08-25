import { createMockEl } from '@test/helpers/mockElement';

import { TabManager } from '@/features/chat/tabs/TabManager';

// Mock dependencies
const mockCreateTab = jest.fn();
const mockDestroyTab = jest.fn().mockResolvedValue(undefined);
const mockActivateTab = jest.fn();
const mockDeactivateTab = jest.fn();
const mockGetTabTitle = jest.fn().mockReturnValue('Test Tab');

jest.mock('@/features/chat/tabs/Tab', () => ({
  createTab: (...args: any[]) => mockCreateTab(...args),
  destroyTab: (...args: any[]) => mockDestroyTab(...args),
  activateTab: (...args: any[]) => mockActivateTab(...args),
  deactivateTab: (...args: any[]) => mockDeactivateTab(...args),
  getTabTitle: (...args: any[]) => mockGetTabTitle(...args),
}));

jest.mock('@/core/providers/ProviderRegistry', () => ({
  ProviderRegistry: {
    createChatRuntime: jest.fn(),
    getCapabilities: jest.fn().mockReturnValue({}),
  },
}));

describe('TabManager reordering', () => {
  let plugin: any;
  let containerEl: HTMLElement;
  let view: any;
  let tabManager: TabManager;

  beforeEach(() => {
    jest.clearAllMocks();

    plugin = {
      settings: { maxTabs: 5 },
      getCachedConversation: jest.fn(),
    };

    containerEl = createMockEl() as any;
    view = {
      leaf: {},
      getTabManager: () => tabManager,
    };

    mockCreateTab.mockImplementation(({ tabId }) => ({
      id: tabId || `tab-${Math.random()}`,
      uiInitialized: true,
      state: { isStreaming: false, needsAttention: false },
      dom: {
        contentEl: createMockEl() as any,
        messagesEl: createMockEl() as any,
      },
    }));

    tabManager = new TabManager(plugin, containerEl, view);
  });

  it('reorders tabs and updates getOrderedTabs and getTabBarItems', async () => {
    await tabManager.createTab(null, 'tab-1');
    await tabManager.createTab(null, 'tab-2');
    await tabManager.createTab(null, 'tab-3');

    expect(tabManager.getOrderedTabs().map(t => t.id)).toEqual(['tab-1', 'tab-2', 'tab-3']);

    // Move tab-3 to position 0
    tabManager.moveTab('tab-3', 0);
    expect(tabManager.getOrderedTabs().map(t => t.id)).toEqual(['tab-3', 'tab-1', 'tab-2']);

    const items = tabManager.getTabBarItems();
    expect(items.map(i => i.id)).toEqual(['tab-3', 'tab-1', 'tab-2']);
    expect(items[0].index).toBe(1);
    expect(items[1].index).toBe(2);
    expect(items[2].index).toBe(3);
  });

  it('clamps moveTab index to valid bounds', async () => {
    await tabManager.createTab(null, 'tab-1');
    await tabManager.createTab(null, 'tab-2');
    await tabManager.createTab(null, 'tab-3');

    // Move to negative index clamps to 0
    tabManager.moveTab('tab-2', -5);
    expect(tabManager.getOrderedTabs().map(t => t.id)).toEqual(['tab-2', 'tab-1', 'tab-3']);

    // Move to large index clamps to last position (2)
    tabManager.moveTab('tab-2', 100);
    expect(tabManager.getOrderedTabs().map(t => t.id)).toEqual(['tab-1', 'tab-3', 'tab-2']);
  });

  it('no-ops when moving unknown tab or moving to same index', async () => {
    await tabManager.createTab(null, 'tab-1');
    await tabManager.createTab(null, 'tab-2');

    tabManager.moveTab('non-existent', 0);
    expect(tabManager.getOrderedTabs().map(t => t.id)).toEqual(['tab-1', 'tab-2']);

    tabManager.moveTab('tab-1', 0);
    expect(tabManager.getOrderedTabs().map(t => t.id)).toEqual(['tab-1', 'tab-2']);
  });
});
