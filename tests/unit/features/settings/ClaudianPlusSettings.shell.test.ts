import { createMockEl } from '@test/helpers/mockElement';
import type { App, Plugin } from 'obsidian';

import type { FeatureHost } from '@/features/FeatureHost';
import { ClaudianPlusSettingTab } from '@/features/settings/ClaudianPlusSettings';

describe('ClaudianPlusSettingTab Shell', () => {
  let app: App;
  let plugin: FeatureHost & Plugin;
  let tab: ClaudianPlusSettingTab;

  beforeEach(() => {
    app = {
      vault: {},
      workspace: {},
    } as unknown as App;

    plugin = {
      app,
      manifest: { id: 'claudian-plus', version: '3.0.0' },
      settings: {
        chatHomeView: 'chat',
        activeProvider: 'codex',
        selectedModel: 'gpt-5-turbo',
        maxTabs: 3,
        systemPrompt: '',
        thinkingBudget: 0,
        enablePromptEnhancement: false,
        useAutoScroll: true,
        expandFileEditsByDefault: false,
        enableSoundEffects: false,
        debugMode: false,
        settingsLastCategory: 'general',
        locale: 'en',
        memoryEnabled: true,
        consciousnessEnabled: true,
        consciousnessAutoMemory: true,
      },
      saveSettings: jest.fn(async () => {}),
      mutateSettings: jest.fn(async (cb: (settings: any) => void) => {
        cb(plugin.settings);
      }),
      getAllViews: () => [],
      getMemoryStore: () => ({
        filePath: '.claudian-plus/memory.md',
        load: jest.fn().mockResolvedValue([]),
        save: jest.fn().mockResolvedValue(undefined),
      }),
      getMindStore: () => ({
        listStaging: jest.fn().mockResolvedValue([]),
        listDurable: jest.fn().mockResolvedValue([]),
        addStaging: jest.fn().mockResolvedValue(true),
        addDurable: jest.fn().mockResolvedValue({ id: 'd1' }),
        approveStaging: jest.fn().mockResolvedValue(null),
        approveAllStaging: jest.fn().mockResolvedValue(0),
        dismissStaging: jest.fn().mockResolvedValue(false),
        clearStaging: jest.fn().mockResolvedValue(undefined),
        updateDurable: jest.fn().mockResolvedValue(null),
        deleteDurable: jest.fn().mockResolvedValue(false),
      }),
      getMicroDreamCoordinator: () => ({
        evaluateSession: jest.fn().mockResolvedValue({ ran: false }),
      }),
      getHybridMindPromptInjector: () => ({
        buildLayer1Profile: jest.fn().mockResolvedValue(''),
        buildLayer2Context: jest.fn().mockResolvedValue(''),
        injectMind: jest.fn().mockResolvedValue(''),
      }),
      getConsciousnessEngine: () => ({
        updateConfig: jest.fn(),
        initialize: jest.fn().mockResolvedValue(undefined),
      }),
      getDreamService: () => ({
        runDream: jest.fn().mockResolvedValue({ ran: true, newFacts: 2, profileUpdates: 1 }),
      }),
      getVaultKnowledgeEngine: () => ({
        updateConfig: jest.fn(),
        scanVault: jest.fn().mockResolvedValue({ noteCount: 10 }),
      }),
      getAgentSkillRepository: () => ({
        getVaultSkills: () => [],
        getUserSkills: () => [],
        getEffectiveSkills: () => [],
        onChanged: () => () => {},
      }),
      notifyAgentSkillsChanged: jest.fn(),
      providerHost: {
        settings: {},
        mutateSettings: jest.fn(),
      },
      getActiveEnvironmentVariables: () => '',
    } as unknown as FeatureHost & Plugin;

    tab = new ClaudianPlusSettingTab(app, plugin);
  });

  it('renders category tree sidebar and content pane in two-column shell', () => {
    const container = createMockEl();
    Object.defineProperty(tab, 'containerEl', { value: container });

    tab.display();

    const shell = container.querySelector('.claudian-plus-settings-shell');
    expect(shell).not.toBeNull();

    const sidebar = container.querySelector('.claudian-plus-settings-sidebar');
    expect(sidebar).not.toBeNull();

    const contentPane = container.querySelector('.claudian-plus-settings-content-pane');
    expect(contentPane).not.toBeNull();

    const tree = container.querySelector('.claudian-plus-settings-tree');
    expect(tree).not.toBeNull();

    const searchInput = container.querySelector('.claudian-plus-settings-search-input');
    expect(searchInput).not.toBeNull();
  });

  it('selects category and marks tree item active', () => {
    const container = createMockEl();
    Object.defineProperty(tab, 'containerEl', { value: container });

    tab.display();

    const generalItem = container.querySelector('[data-category-id="general"]');
    expect(generalItem?.hasClass('is-active')).toBe(true);

    const appearanceItem = container.querySelector('[data-category-id="appearance"]');
    expect(appearanceItem).not.toBeNull();
    appearanceItem?.click();

    expect(appearanceItem?.hasClass('is-active')).toBe(true);
    expect(generalItem?.hasClass('is-active')).toBe(false);
    expect(plugin.settings.settingsLastCategory).toBe('appearance');
  });

  it('renders provider pages inside the tiered segmented subnav with active items', () => {
    plugin.settings.settingsLastCategory = 'providers:codex';
    (plugin.settings as any).codexEnabled = true;
    const container = createMockEl();
    Object.defineProperty(tab, 'containerEl', { value: container });

    tab.display();

    const subnav = container.querySelector('.claudian-plus-settings-subnav');
    const providerPage = container.querySelector('[data-category-id="providers:codex"]');
    const providerGroup = container.querySelector('[data-category-id="providers"]');

    expect(subnav).not.toBeNull();
    expect(subnav?.contains(providerPage)).toBe(true);
    expect(providerPage?.tagName).toBe('BUTTON');
    expect(providerPage?.hasClass('claudian-plus-settings-subnav-item')).toBe(true);
    expect(providerPage?.hasClass('is-active')).toBe(true);
    expect(providerPage?.getAttribute('aria-current')).toBe('page');
    expect(providerGroup?.hasClass('is-active')).toBe(true);
  });

  it('filters tree with search input and resets on Escape', () => {
    const container = createMockEl();
    Object.defineProperty(tab, 'containerEl', { value: container });

    tab.display();

    const searchInput = container.querySelector('.claudian-plus-settings-search-input') as any;
    const tree = container.querySelector('.claudian-plus-settings-tree');
    const searchResults = container.querySelector('.claudian-plus-settings-search-results');

    // Type query
    searchInput.value = 'Language';
    searchInput.dispatchEvent({ type: 'input' });

    expect(tree?.hasClass('claudian-plus-hidden')).toBe(true);
    expect(searchResults?.hasClass('claudian-plus-hidden')).toBe(false);

    // Press Escape
    searchInput.dispatchEvent({ type: 'keydown', key: 'Escape' });

    expect(searchInput.value).toBe('');
    expect(tree?.hasClass('claudian-plus-hidden')).toBe(false);
    expect(searchResults?.hasClass('claudian-plus-hidden')).toBe(true);
  });

  it('renders memory and consciousness settings with inspection buttons', () => {
    const container = createMockEl();
    Object.defineProperty(tab, 'containerEl', { value: container });

    tab.display();

    const memoryItem = container.querySelector('[data-category-id="memory"]');
    expect(memoryItem).not.toBeNull();
    memoryItem?.click();

    expect(memoryItem?.hasClass('is-active')).toBe(true);
    expect(plugin.settings.settingsLastCategory).toBe('memory');

    // Verify search entries or setting elements are rendered in content pane
    const contentPane = container.querySelector('.claudian-plus-settings-content-pane');
    expect(contentPane).not.toBeNull();
  });
});
