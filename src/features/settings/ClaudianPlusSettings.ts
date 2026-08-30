import type { App, Plugin } from 'obsidian';
import { Notice, Platform, PluginSettingTab, setIcon, Setting } from 'obsidian';
import * as path from 'path';

import {
  getHiddenProviderCommands,
  normalizeHiddenCommandList,
} from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from '../../core/providers/types';
import type { ChatViewPlacement } from '../../core/types/settings';
import { getAvailableLocales, getLocaleDisplayName, setLocale, t } from '../../i18n/i18n';
import type { Locale, TranslationKey } from '../../i18n/types';
import { FileViewerModal } from '../../shared/modals/FileViewerModal';
import { renderEnvironmentSettingsSection } from '../../shared/settings/EnvironmentSettingsSection';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import type { FeatureHost } from '../FeatureHost';
import { AgentSkillManagementCoordinator } from './AgentSkillManagementCoordinator';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';
import { MindSettingsTab } from './MindSettingsTab';
import { searchSettings, type SettingsSearchEntry } from './settingsSearch';
import { buildSettingsTree, resolveSelectedCategory, type SettingsCategoryNode } from './settingsTree';
import { WorkspaceResourcesSettings } from './WorkspaceResourcesSettings';


type ObsidianHotkey = { modifiers: string[]; key: string };
type ObsidianHotkeyManager = {
  customKeys?: Record<string, ObsidianHotkey[] | undefined>;
  defaultKeys?: Record<string, ObsidianHotkey[] | undefined>;
};
type ObsidianHotkeyTab = {
  searchInputEl?: HTMLInputElement;
  searchComponent?: { inputEl?: HTMLInputElement };
  updateHotkeyVisibility?: () => void;
};
type ObsidianSettingsController = {
  activeTab?: ObsidianHotkeyTab;
  open: () => void;
  openTabById: (id: string) => void;
};
type AppWithHotkeyInternals = App & {
  hotkeyManager?: ObsidianHotkeyManager;
  setting?: ObsidianSettingsController;
};

function formatHotkey(hotkey: ObsidianHotkey): string {
  const isMac = Platform.isMacOS;
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;

  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

function openHotkeySettings(app: App): void {
  const setting = (app as AppWithHotkeyInternals).setting;
  if (!setting) {
    return;
  }

  setting.open();
  setting.openTabById('hotkeys');
  window.setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) {
      return;
    }

    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) {
      return;
    }

    searchEl.value = 'Claudian Plus';
    tab.updateHotkeyVisibility?.();
  }, 100);
}

function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as AppWithHotkeyInternals).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys = customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;

  if (!hotkeys || hotkeys.length === 0) return null;

  return hotkeys.map(formatHotkey).join(', ');
}

function featureCopy(locale: string, chinese: string, english: string): string {
  return locale.toLowerCase().startsWith('zh') ? chinese : english;
}

function addHotkeySettingRow(
  containerEl: HTMLElement,
  app: App,
  commandId: string,
  translationPrefix: string,
): void {
  const hotkey = getHotkeyForCommand(app, commandId);
  const item = containerEl.createDiv({ cls: 'claudian-plus-hotkey-item' });
  item.createSpan({
    cls: 'claudian-plus-hotkey-name',
    text: t(`${translationPrefix}.name` as TranslationKey),
  });
  if (hotkey) {
    item.createSpan({ cls: 'claudian-plus-hotkey-badge', text: hotkey });
  }
  item.addEventListener('click', () => openHotkeySettings(app));
}

export class ClaudianPlusSettingTab extends PluginSettingTab {
  plugin: FeatureHost & Plugin;
  private selectedCategory = 'general';
  private selectedProviderId: ProviderId = 'codex';
  private refreshTitleModelOptions: (() => void) | null = null;
  private displayGeneration = 0;
  private readonly agentSkillCoordinator: AgentSkillManagementCoordinator;

  // Search & Navigation state
  private searchEntries: SettingsSearchEntry[] = [];
  private searchInputEl: HTMLInputElement | null = null;
  private treeContainerEl: HTMLElement | null = null;
  private treeSubnavContainerEl: HTMLElement | null = null;
  private searchResultsContainerEl: HTMLElement | null = null;
  private contentPaneEl: HTMLElement | null = null;
  private treeItemEls = new Map<string, HTMLElement>();

  constructor(app: App, plugin: FeatureHost & Plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.agentSkillCoordinator = new AgentSkillManagementCoordinator(
      plugin.getAgentSkillRepository(),
      () => plugin.notifyAgentSkillsChanged(),
    );
  }

  getSettingDefinitions(): unknown[] {
    return [];
  }

  display(): void {
    const displayGeneration = ++this.displayGeneration;
    this.agentSkillCoordinator.resetSubscriptions();
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('claudian-plus-settings');
    this.refreshTitleModelOptions = null;
    this.searchEntries = [];
    this.treeItemEls.clear();

    setLocale(this.plugin.settings.locale as Locale);

    const settingsSnapshot = this.plugin.settings as unknown as Record<string, unknown>;
    const enabledProviderIds = ProviderRegistry.getEnabledProviderIds(settingsSnapshot);
    const tree = buildSettingsTree({
      enabledProviderIds,
      getProviderDisplayName: (id) => ProviderRegistry.getProviderDisplayName(id),
      locale: this.plugin.settings.locale,
    });

    const savedCategory = this.plugin.settings.settingsLastCategory;
    this.selectedCategory = resolveSelectedCategory(savedCategory, tree);

    const shell = containerEl.createDiv({ cls: 'claudian-plus-settings-shell' });

    // --- Header Area: Search + Horizontal Category Nav Bar ---
    const sidebar = shell.createDiv({ cls: 'claudian-plus-settings-sidebar' });

    // Search header
    const searchWrapper = sidebar.createDiv({ cls: 'claudian-plus-settings-search-wrapper' });
    const searchIcon = searchWrapper.createSpan({ cls: 'claudian-plus-settings-search-icon' });
    setIcon(searchIcon, 'search');

    this.searchInputEl = searchWrapper.createEl('input', {
      type: 'text',
      cls: 'claudian-plus-settings-search-input',
      placeholder: 'Search settings...',
    });

    // Horizontal category bar container
    this.treeContainerEl = sidebar.createDiv({ cls: 'claudian-plus-settings-tree' });
    this.treeSubnavContainerEl = sidebar.createDiv({
      cls: 'claudian-plus-settings-subnav' + (this.selectedCategory.startsWith('providers') ? '' : ' claudian-plus-hidden'),
    });
    this.searchResultsContainerEl = sidebar.createDiv({
      cls: 'claudian-plus-settings-search-results claudian-plus-hidden',
    });

    // Search input handler
    this.searchInputEl.addEventListener('input', () => {
      this.handleSearchInput();
    });
    this.searchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.searchInputEl) {
          this.searchInputEl.value = '';
          this.handleSearchInput();
        }
      }
    });

    // Render tree nodes
    for (const node of tree) {
      this.renderTreeNode(this.treeContainerEl, node);
    }

    // --- Full-Width Content Pane ---
    this.contentPaneEl = shell.createDiv({ cls: 'claudian-plus-settings-content-pane' });

    this.renderSelectedCategory(displayGeneration);
  }

  private renderTreeNode(container: HTMLElement, node: SettingsCategoryNode, isChild = false): void {
    const targetContainer = isChild && this.treeSubnavContainerEl ? this.treeSubnavContainerEl : container;
    const isNodeActive = node.id === this.selectedCategory || (this.selectedCategory.startsWith('providers') && node.id === 'providers');

    const itemEl = targetContainer.createDiv({
      cls: [
        'claudian-plus-settings-tree-item',
        isChild ? 'claudian-plus-settings-tree-child' : '',
        isNodeActive ? 'is-active' : '',
      ].filter(Boolean).join(' '),
      attr: { 'data-category-id': node.id },
    });

    if (node.icon) {
      const iconEl = itemEl.createSpan();
      setIcon(iconEl, node.icon);
    }

    itemEl.createSpan({ text: node.label });

    itemEl.addEventListener('click', () => {
      this.selectCategory(node.id);
    });

    this.treeItemEls.set(node.id, itemEl);

    if (node.children) {
      for (const child of node.children) {
        this.renderTreeNode(container, child, true);
      }
    }
  }

  public selectCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    this.plugin.settings.settingsLastCategory = categoryId;
    void this.plugin.mutateSettings((settings) => {
      settings.settingsLastCategory = categoryId;
    });

    const isProviderCategory = categoryId.startsWith('providers');
    this.treeSubnavContainerEl?.toggleClass('claudian-plus-hidden', !isProviderCategory);

    for (const [id, el] of this.treeItemEls.entries()) {
      const isActive = id === categoryId || (isProviderCategory && id === 'providers');
      el.toggleClass('is-active', isActive);
    }

    this.renderSelectedCategory(this.displayGeneration);
  }

  private handleSearchInput(): void {
    const query = this.searchInputEl?.value.trim() ?? '';
    if (!query) {
      this.treeContainerEl?.removeClass('claudian-plus-hidden');
      if (this.selectedCategory.startsWith('providers')) {
        this.treeSubnavContainerEl?.removeClass('claudian-plus-hidden');
      } else {
        this.treeSubnavContainerEl?.addClass('claudian-plus-hidden');
      }
      this.searchResultsContainerEl?.addClass('claudian-plus-hidden');
      return;
    }

    this.treeContainerEl?.addClass('claudian-plus-hidden');
    this.treeSubnavContainerEl?.addClass('claudian-plus-hidden');
    this.searchResultsContainerEl?.removeClass('claudian-plus-hidden');
    this.searchResultsContainerEl?.empty();

    const results = searchSettings(query, this.searchEntries);

    if (results.length === 0) {
      this.searchResultsContainerEl?.createDiv({
        cls: 'claudian-plus-settings-search-result-crumb claudian-plus-settings-search-empty',
        text: 'No matching settings',
      });
      return;
    }

    for (const res of results) {
      const row = this.searchResultsContainerEl?.createDiv({
        cls: 'claudian-plus-settings-search-result-item',
      });
      if (!row) continue;

      row.createSpan({
        cls: 'claudian-plus-settings-search-result-name',
        text: res.entry.name,
      });

      if (res.entry.categoryLabel) {
        row.createSpan({
          cls: 'claudian-plus-settings-search-result-crumb',
          text: res.entry.categoryLabel,
        });
      }

      row.addEventListener('click', () => {
        this.selectCategory(res.entry.categoryId);
        if (res.entry.targetEl) {
          window.setTimeout(() => {
            res.entry.targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            res.entry.targetEl?.addClass('claudian-plus-settings-highlight-flash');
            window.setTimeout(() => {
              res.entry.targetEl?.removeClass('claudian-plus-settings-highlight-flash');
            }, 1600);
          }, 50);
        }
      });
    }
  }

  private registerSearchEntry(entry: SettingsSearchEntry): void {
    this.searchEntries.push(entry);
  }

  private renderSelectedCategory(displayGeneration: number): void {
    if (!this.contentPaneEl) return;
    this.contentPaneEl.empty();

    if (this.selectedCategory.startsWith('providers:')) {
      const providerId = this.selectedCategory.slice('providers:'.length);
      this.renderProviderSubpage(this.contentPaneEl, providerId, displayGeneration);
      return;
    }

    switch (this.selectedCategory) {
      case 'general':
        this.renderGeneralCategory(this.contentPaneEl);
        break;
      case 'appearance':
        this.renderAppearanceCategory(this.contentPaneEl);
        break;
      case 'memory':
        this.renderMemoryCategory(this.contentPaneEl);
        break;
      case 'providers':
        this.renderProvidersOverviewCategory(this.contentPaneEl);
        break;
      case 'agents-skills':
        this.renderAgentsSkillsCategory(this.contentPaneEl);
        break;
      case 'workspace':
        this.renderWorkspaceCategory(this.contentPaneEl);
        break;
      case 'advanced':
        this.renderAdvancedCategory(this.contentPaneEl);
        break;
      default:
        this.renderGeneralCategory(this.contentPaneEl);
        break;
    }
  }

  private createCard(container: HTMLElement, title?: string): HTMLElement {
    const card = container.createDiv({ cls: 'claudian-plus-settings-card' });
    if (title) {
      card.createDiv({ cls: 'claudian-plus-settings-card-header', text: title });
    }
    return card;
  }

  // --- Category: General ---
  private renderGeneralCategory(container: HTMLElement): void {
    const card = this.createCard(container, t('settings.category.general') || 'General');

    // Language
    const langSetting = new Setting(card)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((dropdown) => {
        const locales = getAvailableLocales();
        for (const locale of locales) {
          dropdown.addOption(locale, getLocaleDisplayName(locale));
        }
        dropdown
          .setValue(this.plugin.settings.locale)
          .onChange(async (value) => {
            const locale = value as Locale;
            if (!setLocale(locale)) {
              dropdown.setValue(this.plugin.settings.locale);
              return;
            }
            await this.plugin.mutateSettings((settings) => {
              settings.locale = locale;
            });
            this.display();
          });
      });
    this.registerSearchEntry({
      categoryId: 'general',
      categoryLabel: 'General',
      settingKey: 'language',
      name: t('settings.language.name'),
      desc: t('settings.language.desc'),
      targetEl: langSetting.settingEl,
    });

    // User Name
    const nameSetting = new Setting(card)
      .setName(t('settings.userName.name'))
      .setDesc(t('settings.userName.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.userName.name'))
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.userName = value;
            });
          });
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });
    this.registerSearchEntry({
      categoryId: 'general',
      categoryLabel: 'General',
      settingKey: 'user-name',
      name: t('settings.userName.name'),
      desc: t('settings.userName.desc'),
      targetEl: nameSetting.settingEl,
    });

    // Default Chat Provider
    const providerSetting = new Setting(card)
      .setName(t('settings.defaultChatProvider.name'))
      .setDesc(t('settings.defaultChatProvider.desc'))
      .addDropdown((dropdown) => {
        dropdown.addOption('', t('settings.defaultChatProvider.followModel'));
        const settingsSnapshot = this.plugin.settings as unknown as Record<string, unknown>;
        for (const providerId of ProviderRegistry.getEnabledProviderIds(settingsSnapshot)) {
          dropdown.addOption(providerId, ProviderRegistry.getProviderDisplayName(providerId));
        }
        dropdown
          .setValue(this.plugin.settings.defaultChatProviderId || '')
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.defaultChatProviderId = value;
            });
            for (const view of this.plugin.getAllViews()) {
              view.refreshModelSelector();
            }
          });
      });
    this.registerSearchEntry({
      categoryId: 'general',
      categoryLabel: 'General',
      settingKey: 'default-chat-provider',
      name: t('settings.defaultChatProvider.name'),
      desc: t('settings.defaultChatProvider.desc'),
      targetEl: providerSetting.settingEl,
    });

    // System Prompt
    const promptSetting = new Setting(card)
      .setName(t('settings.systemPrompt.name'))
      .setDesc(t('settings.systemPrompt.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder(t('settings.systemPrompt.name'))
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.systemPrompt = value;
            });
          });
        text.inputEl.rows = 5;
        text.inputEl.cols = 45;
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });
    this.registerSearchEntry({
      categoryId: 'general',
      categoryLabel: 'General',
      settingKey: 'system-prompt',
      name: t('settings.systemPrompt.name'),
      desc: t('settings.systemPrompt.desc'),
      targetEl: promptSetting.settingEl,
    });

    // Auto Title Generation
    const titleCard = this.createCard(container, t('settings.conversations'));
    const autoTitleSetting = new Setting(titleCard)
      .setName(t('settings.autoTitle.name'))
      .setDesc(t('settings.autoTitle.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.enableAutoTitleGeneration = value;
            });
            this.display();
          })
      );
    this.registerSearchEntry({
      categoryId: 'general',
      categoryLabel: 'General',
      settingKey: 'auto-title',
      name: t('settings.autoTitle.name'),
      desc: t('settings.autoTitle.desc'),
      targetEl: autoTitleSetting.settingEl,
    });

    if (this.plugin.settings.enableAutoTitleGeneration) {
      const titleModelSetting = new Setting(titleCard)
        .setName(t('settings.titleModel.name'))
        .setDesc(t('settings.titleModel.desc'))
        .addDropdown((dropdown) => {
          const refreshOptions = (): void => {
            dropdown.selectEl.replaceChildren();
            dropdown.addOption('', t('settings.titleModel.auto'));

            const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
            for (const model of ProviderRegistry.getTitleGenerationModelOptions(settingsBag)) {
              dropdown.addOption(model.value, model.label);
            }
            dropdown.setValue(this.plugin.settings.titleGenerationModel || '');
          };

          this.refreshTitleModelOptions = refreshOptions;
          refreshOptions();
          dropdown.onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              ProviderSettingsCoordinator.applyTitleGenerationModelSelection(settings, value);
            });
          });
        });
      this.registerSearchEntry({
        categoryId: 'general',
        categoryLabel: 'General',
        settingKey: 'title-model',
        name: t('settings.titleModel.name'),
        desc: t('settings.titleModel.desc'),
        targetEl: titleModelSetting.settingEl,
      });
    }
  }

  // --- Category: Appearance ---
  private renderAppearanceCategory(container: HTMLElement): void {
    const card = this.createCard(container, t('settings.category.appearance') || 'Appearance');

    // Max Tabs
    const maxTabsSetting = new Setting(card)
      .setName(t('settings.maxTabs.name'))
      .setDesc(t('settings.maxTabs.desc'));

    const maxTabsWarningEl = card.createDiv({
      cls: 'claudian-plus-max-tabs-warning claudian-plus-setting-validation claudian-plus-setting-validation-warning claudian-plus-hidden',
    });
    maxTabsWarningEl.setText(t('settings.maxTabs.warning'));

    const updateMaxTabsWarning = (value: number): void => {
      maxTabsWarningEl.toggleClass('claudian-plus-hidden', value <= 5);
    };

    maxTabsSetting.addSlider((slider) => {
      slider
        .setLimits(3, 10, 1)
        .setValue(this.plugin.settings.maxTabs ?? 3)
        .setDynamicTooltip()
        .onChange(async (value) => {
          await this.plugin.mutateSettings((settings) => {
            settings.maxTabs = value;
          });
          updateMaxTabsWarning(value);
          for (const view of this.plugin.getAllViews()) {
            view.refreshTabControls();
          }
        });
      updateMaxTabsWarning(this.plugin.settings.maxTabs ?? 3);
    });

    const sliderScale = maxTabsSetting.controlEl.createDiv({ cls: 'claudian-plus-max-tabs-scale' });
    sliderScale.createSpan({ text: '3' });
    sliderScale.createSpan({ text: '10' });

    this.registerSearchEntry({
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      settingKey: 'max-tabs',
      name: t('settings.maxTabs.name'),
      desc: t('settings.maxTabs.desc'),
      targetEl: maxTabsSetting.settingEl,
    });

    // Chat View Placement
    const placementSetting = new Setting(card)
      .setName(t('settings.chatViewPlacement.name'))
      .setDesc(t('settings.chatViewPlacement.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('right-sidebar', t('settings.chatViewPlacement.rightSidebar'))
          .addOption('left-sidebar', t('settings.chatViewPlacement.leftSidebar'))
          .addOption('main-tab', t('settings.chatViewPlacement.mainTab'))
          .setValue(this.plugin.settings.chatViewPlacement)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.chatViewPlacement = value as ChatViewPlacement;
            });
          });
      });
    this.registerSearchEntry({
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      settingKey: 'chat-view-placement',
      name: t('settings.chatViewPlacement.name'),
      desc: t('settings.chatViewPlacement.desc'),
      targetEl: placementSetting.settingEl,
    });

    // Outline Side
    const outlineSetting = new Setting(card)
      .setName(featureCopy(this.plugin.settings.locale, '悬浮大纲位置', 'Outline side'))
      .setDesc(featureCopy(
        this.plugin.settings.locale,
        '选择聊天侧边栏中悬浮大纲轨道显示在聊天区域的哪一侧。',
        'Choose which side of the conversation the floating outline rail appears on.',
      ))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('left', 'Left')
          .addOption('right', 'Right')
          .setValue(this.plugin.settings.outlineSide ?? 'left')
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.outlineSide = value as 'left' | 'right';
            });
            for (const view of this.plugin.getAllViews()) {
              view.refreshOutlineSide?.();
            }
          });
      });
    this.registerSearchEntry({
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      settingKey: 'outline-side',
      name: 'Outline side',
      desc: 'Floating outline rail location',
      targetEl: outlineSetting.settingEl,
    });

    // Welcome Animation
    const animSetting = new Setting(card)
      .setName(t('settings.welcomeAnimation.name'))
      .setDesc(t('settings.welcomeAnimation.desc'))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('full', t('settings.welcomeAnimation.full'))
          .addOption('lite', t('settings.welcomeAnimation.lite'))
          .addOption('off', t('settings.welcomeAnimation.off'))
          .setValue(this.plugin.settings.welcomeAnimationMode ?? 'full')
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.welcomeAnimationMode = value as 'full' | 'lite' | 'off';
            });
            for (const view of this.plugin.getAllViews()) {
              view.refreshWelcomeAnimation?.();
            }
          });
      });
    this.registerSearchEntry({
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      settingKey: 'welcome-animation',
      name: t('settings.welcomeAnimation.name'),
      desc: t('settings.welcomeAnimation.desc'),
      targetEl: animSetting.settingEl,
    });

    // Blob Follow Pointer
    const blobSetting = new Setting(card)
      .setName(t('settings.blobFollow.name'))
      .setDesc(t('settings.blobFollow.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.blobFollowPointer ?? true)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.blobFollowPointer = value;
            });
            for (const view of this.plugin.getAllViews()) {
              view.refreshWelcomeAnimation?.();
            }
          })
      );
    this.registerSearchEntry({
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      settingKey: 'blob-follow',
      name: t('settings.blobFollow.name'),
      desc: t('settings.blobFollow.desc'),
      targetEl: blobSetting.settingEl,
    });

    // Auto Scroll & Markdown options
    const autoScrollSetting = new Setting(card)
      .setName(t('settings.enableAutoScroll.name'))
      .setDesc(t('settings.enableAutoScroll.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoScroll ?? true)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.enableAutoScroll = value;
            });
          })
      );
    this.registerSearchEntry({
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      settingKey: 'auto-scroll',
      name: t('settings.enableAutoScroll.name'),
      desc: t('settings.enableAutoScroll.desc'),
      targetEl: autoScrollSetting.settingEl,
    });

    const mathSetting = new Setting(card)
      .setName(t('settings.deferMathRenderingDuringStreaming.name'))
      .setDesc(t('settings.deferMathRenderingDuringStreaming.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deferMathRenderingDuringStreaming ?? true)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.deferMathRenderingDuringStreaming = value;
            });
          })
      );
    this.registerSearchEntry({
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      settingKey: 'defer-math',
      name: t('settings.deferMathRenderingDuringStreaming.name'),
      desc: t('settings.deferMathRenderingDuringStreaming.desc'),
      targetEl: mathSetting.settingEl,
    });

    const editSetting = new Setting(card)
      .setName(t('settings.expandFileEditsByDefault.name'))
      .setDesc(t('settings.expandFileEditsByDefault.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.expandFileEditsByDefault ?? false)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.expandFileEditsByDefault = value;
            });
          })
      );
    this.registerSearchEntry({
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      settingKey: 'expand-edits',
      name: t('settings.expandFileEditsByDefault.name'),
      desc: t('settings.expandFileEditsByDefault.desc'),
      targetEl: editSetting.settingEl,
    });
  }

  // --- Category: Memory & Consciousness ---
  private renderMemoryCategory(container: HTMLElement): void {
    const locale = this.plugin.settings.locale;

    // --- 0. AI Mind & Habits (Dreaming V3) ---
    const mindTabContainer = container.createDiv({ cls: 'claudian-plus-mind-tab-wrapper' });
    const mindTab = new MindSettingsTab({
      containerEl: mindTabContainer,
      mindStore: this.plugin.getMindStore(),
      locale,
    });
    void mindTab.render();

    // --- 1. Legacy Memory Card ---
    const memoryCard = this.createCard(container, t('settings.memory.heading'));


    const memSetting = new Setting(memoryCard)
      .setName(t('settings.memory.enabled.name'))
      .setDesc(t('settings.memory.enabled.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.memoryEnabled)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.memoryEnabled = value;
            });
            this.display();
          })
      );
    this.registerSearchEntry({
      categoryId: 'memory',
      categoryLabel: 'Memory & Consciousness',
      settingKey: 'memory-enabled',
      name: t('settings.memory.enabled.name'),
      desc: t('settings.memory.enabled.desc'),
      targetEl: memSetting.settingEl,
    });

    if (this.plugin.settings.memoryEnabled) {
      const pathSetting = new Setting(memoryCard)
        .setName(t('settings.memory.filePath.name'))
        .setDesc(t('settings.memory.filePath.desc'))
        .addText((text) =>
          text
            .setValue(this.plugin.settings.memoryFilePath || '.claudian-plus/memory.md')
            .onChange(async (value) => {
              await this.plugin.mutateSettings((settings) => {
                settings.memoryFilePath = value.trim();
              });
            })
        );
      this.registerSearchEntry({
        categoryId: 'memory',
        categoryLabel: 'Memory & Consciousness',
        settingKey: 'memory-path',
        name: t('settings.memory.filePath.name'),
        desc: t('settings.memory.filePath.desc'),
        targetEl: pathSetting.settingEl,
      });

      const maxCharsSetting = new Setting(memoryCard)
        .setName(t('settings.memory.maxChars.name'))
        .setDesc(t('settings.memory.maxChars.desc'))
        .addSlider((slider) => {
          slider
            .setLimits(500, 5000, 100)
            .setValue(this.plugin.settings.memoryMaxInjectionChars ?? 1500)
            .setDynamicTooltip()
            .onChange(async (value) => {
              await this.plugin.mutateSettings((settings) => {
                settings.memoryMaxInjectionChars = value;
              });
            });
        });
      this.registerSearchEntry({
        categoryId: 'memory',
        categoryLabel: 'Memory & Consciousness',
        settingKey: 'memory-max-chars',
        name: t('settings.memory.maxChars.name'),
        desc: t('settings.memory.maxChars.desc'),
        targetEl: maxCharsSetting.settingEl,
      });

      const globalCharsSetting = new Setting(memoryCard)
        .setName(featureCopy(locale, '全局画像预算（字符）', 'Global profile budget (chars)'))
        .setDesc(featureCopy(
          locale,
          '用户画像层在总预算内可占用的上限。',
          'Cap for the user mind profile layer within the total budget.',
        ))
        .addSlider((slider) => {
          slider
            .setLimits(100, 1500, 50)
            .setValue(this.plugin.settings.memoryMaxGlobalInjectionChars)
            .setDynamicTooltip()
            .onChange(async (value) => {
              await this.plugin.mutateSettings((settings) => {
                settings.memoryMaxGlobalInjectionChars = value;
              });
            });
        });
      this.registerSearchEntry({
        categoryId: 'memory',
        categoryLabel: 'Memory & Consciousness',
        settingKey: 'memory-global-chars',
        name: featureCopy(locale, '全局画像预算（字符）', 'Global profile budget (chars)'),
        desc: featureCopy(
          locale,
          '用户画像层在总预算内可占用的上限。',
          'Cap for the user mind profile layer within the total budget.',
        ),
        targetEl: globalCharsSetting.settingEl,
      });

      const projectCharsSetting = new Setting(memoryCard)
        .setName(featureCopy(locale, '项目规则预算（字符）', 'Project rules budget (chars)'))
        .setDesc(featureCopy(
          locale,
          '动态项目规则层在总预算内可占用的上限。',
          'Cap for the dynamic project rules layer within the total budget.',
        ))
        .addSlider((slider) => {
          slider
            .setLimits(100, 2000, 50)
            .setValue(this.plugin.settings.memoryMaxProjectInjectionChars)
            .setDynamicTooltip()
            .onChange(async (value) => {
              await this.plugin.mutateSettings((settings) => {
                settings.memoryMaxProjectInjectionChars = value;
              });
            });
        });
      this.registerSearchEntry({
        categoryId: 'memory',
        categoryLabel: 'Memory & Consciousness',
        settingKey: 'memory-project-chars',
        name: featureCopy(locale, '项目规则预算（字符）', 'Project rules budget (chars)'),
        desc: featureCopy(
          locale,
          '动态项目规则层在总预算内可占用的上限。',
          'Cap for the dynamic project rules layer within the total budget.',
        ),
        targetEl: projectCharsSetting.settingEl,
      });

      const memoryButtonSetting = new Setting(memoryCard)
        .setName(t('settings.memory.manage.name'))
        .setDesc(t('settings.memory.manage.desc'));

      memoryButtonSetting.addButton((button) => {
        button
          .setButtonText(t('settings.memory.viewBtn'))
          .setCta()
          .onClick(async () => {
            const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath || '';
            const memoryPath = this.plugin.settings.memoryFilePath || '.claudian-plus/memory.md';
            const absolutePath = path.isAbsolute(memoryPath)
              ? memoryPath
              : path.join(vaultPath, memoryPath);

            new FileViewerModal(this.app, featureCopy(locale, '长期记忆文件', 'Memory files'), [
              { label: featureCopy(locale, '长期记忆 (memory.md)', 'Long-term memory (memory.md)'), path: absolutePath },
            ]).open();
          });
      });

      memoryButtonSetting.addButton((button) => {
        button
          .setButtonText(t('settings.memory.clearBtn'))
          .setWarning()
          .onClick(async () => {
            const memoryStore = this.plugin.getMemoryStore();
            const entries = await memoryStore.load();
            if (entries.length === 0) {
              new Notice(t('settings.memory.alreadyEmpty'));
              return;
            }
            await memoryStore.save([]);
            new Notice(t('settings.memory.cleared'));
            this.display();
          });
      });

      const memoryStatusSetting = new Setting(memoryCard)
        .setName(featureCopy(locale, '记忆文件状态', 'Memory file status'))
        .setDesc(featureCopy(locale, '读取中…', 'Loading…'));
      void (async () => {
        try {
          const store = this.plugin.getMemoryStore();
          const entries = await store.load();
          memoryStatusSetting.setDesc(featureCopy(
            locale,
            `路径：${store.filePath}，共 ${entries.length} 条记忆。每次写入前自动备份到 .claudian-plus/backups/（保留 20 份）。`,
            `Path: ${store.filePath}, ${entries.length} entrie(s). A backup is kept in .claudian-plus/backups/ before every write (20 retained).`,
          ));
        } catch {
          memoryStatusSetting.setDesc(featureCopy(locale, '读取失败', 'Failed to load memory status'));
        }
      })();
    }

    // --- 2. Consciousness & Awareness Network Card ---
    const consciousnessCard = this.createCard(
      container,
      t('settings.consciousness.heading') || 'Consciousness'
    );

    const consciousnessSetting = new Setting(consciousnessCard)
      .setName(t('settings.consciousness.enabled.name'))
      .setDesc(t('settings.consciousness.enabled.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.consciousnessEnabled ?? false)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.consciousnessEnabled = value;
            });
            const engine = this.plugin.getConsciousnessEngine();
            engine.updateConfig({
              enabled: value,
              autoMemoryEnabled: this.plugin.settings.consciousnessAutoMemory,
            });
            if (value) {
              await engine.initialize();
            }
            this.display();
          })
      );
    this.registerSearchEntry({
      categoryId: 'memory',
      categoryLabel: 'Memory & Consciousness',
      settingKey: 'consciousness-enabled',
      name: t('settings.consciousness.enabled.name'),
      desc: t('settings.consciousness.enabled.desc'),
      targetEl: consciousnessSetting.settingEl,
    });

    if (this.plugin.settings.consciousnessEnabled ?? false) {
      const autoMemSetting = new Setting(consciousnessCard)
        .setName(t('settings.consciousness.autoMemory.name'))
        .setDesc(t('settings.consciousness.autoMemory.desc'))
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.consciousnessAutoMemory ?? false)
            .onChange(async (value) => {
              await this.plugin.mutateSettings((settings) => {
                settings.consciousnessAutoMemory = value;
              });
              this.plugin.getConsciousnessEngine().updateConfig({ autoMemoryEnabled: value });
              this.display();
            })
        );
      this.registerSearchEntry({
        categoryId: 'memory',
        categoryLabel: 'Memory & Consciousness',
        settingKey: 'consciousness-auto-memory',
        name: t('settings.consciousness.autoMemory.name'),
        desc: t('settings.consciousness.autoMemory.desc'),
        targetEl: autoMemSetting.settingEl,
      });

      if (this.plugin.settings.consciousnessAutoMemory ?? false) {
        const dreamHeading = consciousnessCard.createDiv({
          cls: 'claudian-plus-settings-subheading',
          text: t('settings.dream.heading'),
        });
        dreamHeading.createDiv({
          cls: 'claudian-plus-settings-feature-guide-copy',
          text: t('settings.dream.desc'),
        });

        const hours = Math.max(1, Math.round((this.plugin.settings.dreamIntervalMs ?? 24 * 60 * 60 * 1000) / (60 * 60 * 1000)));
        new Setting(consciousnessCard)
          .setName(t('settings.dream.interval.name'))
          .setDesc(t('settings.dream.interval.desc'))
          .addText((text) =>
            text
              .setValue(String(hours))
              .onChange(async (value) => {
                const parsed = Math.max(1, Number.parseInt(value, 10) || 24);
                await this.plugin.mutateSettings((settings) => {
                  settings.dreamIntervalMs = parsed * 60 * 60 * 1000;
                });
              })
          );

        new Setting(consciousnessCard)
          .setName(t('settings.dream.maxLogDays.name'))
          .setDesc(t('settings.dream.maxLogDays.desc'))
          .addText((text) =>
            text
              .setValue(String(this.plugin.settings.dreamMaxLogDays ?? 7))
              .onChange(async (value) => {
                const parsed = Math.max(1, Number.parseInt(value, 10) || 7);
                await this.plugin.mutateSettings((settings) => {
                  settings.dreamMaxLogDays = parsed;
                });
              })
          );

        new Setting(consciousnessCard)
          .setName(t('settings.dream.inputCap.name'))
          .setDesc(t('settings.dream.inputCap.desc'))
          .addText((text) =>
            text
              .setValue(String(this.plugin.settings.dreamInputCharCap ?? 8000))
              .onChange(async (value) => {
                const parsed = Math.max(1000, Number.parseInt(value, 10) || 8000);
                await this.plugin.mutateSettings((settings) => {
                  settings.dreamInputCharCap = parsed;
                });
              })
          );

        new Setting(consciousnessCard)
          .setName(t('settings.dream.maxNewFacts.name'))
          .setDesc(t('settings.dream.maxNewFacts.desc'))
          .addText((text) =>
            text
              .setValue(String(this.plugin.settings.dreamMaxNewFacts ?? 10))
              .onChange(async (value) => {
                const parsed = Math.max(1, Number.parseInt(value, 10) || 10);
                await this.plugin.mutateSettings((settings) => {
                  settings.dreamMaxNewFacts = parsed;
                });
              })
          );

        new Setting(consciousnessCard)
          .setName(t('settings.dream.runNow'))
          .setDesc(t('settings.dream.runNowDesc'))
          .addButton((button) => {
            button
              .setButtonText(t('settings.dream.runNow'))
              .setCta()
              .onClick(async () => {
                const result = await this.plugin.getDreamService().runDream(true);
                if (result.ran) {
                  new Notice(`Dream memory consolidated: ${result.newFacts} fact(s), ${result.profileUpdates} profile update(s).`);
                } else if (result.reason === 'no-new-logs') {
                  new Notice('No new short-term memories to consolidate.');
                } else if (result.reason === 'already-running') {
                  new Notice('A memory consolidation is already running.');
                } else if (result.reason === 'failed') {
                  new Notice(`Memory consolidation failed: ${result.error ?? 'unknown error'}`);
                }
              });
          });
      }

      // View Consciousness Files button
      const consciousnessButtonSetting = new Setting(consciousnessCard)
        .setName(t('settings.consciousness.viewBtn'))
        .setDesc('.claudian-plus/awareness/');

      consciousnessButtonSetting.addButton((button) => {
        button
          .setButtonText(t('settings.consciousness.viewBtn'))
          .setCta()
          .onClick(async () => {
            const engine = this.plugin.getConsciousnessEngine();
            await engine.initialize();

            const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath || '';
            const soulPath = path.join(vaultPath, '.claudian-plus', 'awareness', 'SOUL.md');
            const userPath = path.join(vaultPath, '.claudian-plus', 'awareness', 'USER.md');
            const activityPath = path.join(vaultPath, '.claudian-plus', 'awareness', 'activity.json');

            new FileViewerModal(this.app, featureCopy(locale, '意识网络文件 (Awareness Network)', 'Awareness Network files'), [
              { label: featureCopy(locale, '用户画像 (USER.md)', 'User profile (USER.md)'), path: userPath },
              { label: featureCopy(locale, '协作风格 (SOUL.md)', 'Collaboration style (SOUL.md)'), path: soulPath },
              { label: featureCopy(locale, '活动记录 (activity.json)', 'Activity log (activity.json)'), path: activityPath },
            ]).open();
          });
      });
    }

    // --- 3. Vault Knowledge Card ---
    const vaultCard = this.createCard(
      container,
      featureCopy(locale, 'Vault 知识索引', 'Vault Knowledge Index')
    );
    const vaultKnowledgeEnabled =
      this.plugin.settings.vaultKnowledgeEnabled ?? this.plugin.settings.consciousnessEnabled;

    const vaultSetting = new Setting(vaultCard)
      .setName(featureCopy(locale, '启用 Vault 知识索引', 'Enable vault knowledge index'))
      .setDesc(
        featureCopy(
          locale,
          '扫描笔记的标题、标签、目录和摘要，生成知识概览并注入对话。',
          'Index note titles, tags, folders, and excerpts for a compact knowledge summary.'
        )
      )
      .addToggle((toggle) =>
        toggle.setValue(vaultKnowledgeEnabled).onChange(async (value) => {
          await this.plugin.mutateSettings((settings) => {
            settings.vaultKnowledgeEnabled = value;
          });
          this.plugin.getVaultKnowledgeEngine().updateConfig({ enabled: value });
          this.display();
        })
      );
    this.registerSearchEntry({
      categoryId: 'memory',
      categoryLabel: 'Memory & Consciousness',
      settingKey: 'vault-knowledge',
      name: 'Vault Knowledge Index',
      desc: 'Index note titles, tags, and summaries',
      targetEl: vaultSetting.settingEl,
    });

    const scanAction = new Setting(vaultCard)
      .setName(featureCopy(locale, '立即执行', 'Run now'))
      .setDesc(
        featureCopy(
          locale,
          '第一次使用前，可以手动建立知识索引。',
          'Build the index immediately.'
        )
      );
    scanAction.addButton((button) => {
      button
        .setButtonText(featureCopy(locale, '扫描 Vault', 'Scan vault'))
        .onClick(async () => {
          if (!(this.plugin.settings.vaultKnowledgeEnabled ?? this.plugin.settings.consciousnessEnabled)) {
            new Notice(
              featureCopy(
                locale,
                '请先开启 Vault 知识索引。',
                'Enable the vault knowledge index first.'
              )
            );
            return;
          }
          new Notice(featureCopy(locale, '正在扫描 Vault…', 'Scanning vault…'));
          try {
            const index = await this.plugin.getVaultKnowledgeEngine().scanVault();
            new Notice(
              featureCopy(
                locale,
                `已索引 ${index.noteCount} 篇笔记。`,
                `Indexed ${index.noteCount} notes.`
              )
            );
          } catch (error) {
            new Notice(
              `${featureCopy(locale, '扫描失败', 'Scan failed')}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        });
    });
  }

  // --- Category: Providers Overview ---
  private renderProvidersOverviewCategory(container: HTMLElement): void {
    const card = this.createCard(container, t('settings.category.providers') || 'Providers');

    const defaultProviderSetting = new Setting(card)
      .setName(featureCopy(this.plugin.settings.locale, '默认提供商', 'Default Provider'))
      .setDesc(
        featureCopy(
          this.plugin.settings.locale,
          '选择全局创建新聊天面板时的默认 AI 提供商',
          'Choose the default AI provider for new conversations'
        )
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('auto', featureCopy(this.plugin.settings.locale, '跟随所选模型', 'Follow selected model'));
        for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
          dropdown.addOption(providerId, ProviderRegistry.getProviderDisplayName(providerId));
        }
        dropdown.setValue(this.plugin.settings.settingsProvider || 'auto');
        dropdown.onChange(async (val) => {
          await this.plugin.mutateSettings((settings) => {
            settings.settingsProvider = val;
          });
        });
      });
    this.registerSearchEntry({
      categoryId: 'providers',
      categoryLabel: 'Providers',
      settingKey: 'settings-provider',
      name: 'Default Provider',
      desc: 'Default AI provider for new conversations',
      targetEl: defaultProviderSetting.settingEl,
    });

    // Registered providers list with jump buttons
    const listCard = this.createCard(container, featureCopy(this.plugin.settings.locale, '已配置的提供商', 'Configured Providers'));
    for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
      const row = new Setting(listCard)
        .setName(ProviderRegistry.getProviderDisplayName(providerId))
        .setDesc(`Configure ${ProviderRegistry.getProviderDisplayName(providerId)} settings`);
      row.addButton((btn) => {
        btn.setButtonText('Configure').onClick(() => {
          this.selectCategory(`providers:${providerId}`);
        });
      });
    }
  }

  // --- Category: Provider Subpage ---
  private renderProviderSubpage(container: HTMLElement, providerId: ProviderId, displayGeneration: number): void {
    const providerName = ProviderRegistry.getProviderDisplayName(providerId);
    const card = this.createCard(container, `${providerName} Settings`);
    const contentArea = card.createDiv({ cls: 'claudian-plus-provider-settings-content' });

    void this.renderProviderTabContent(providerId, contentArea, displayGeneration);
  }

  private async renderProviderTabContent(
    providerId: ProviderId,
    targetEl: HTMLElement,
    displayGeneration: number
  ): Promise<void> {
    targetEl.empty();
    targetEl.createDiv({
      cls: 'claudian-plus-settings-provider-loading',
      text: featureCopy(
        this.plugin.settings.locale,
        `正在加载 ${ProviderRegistry.getProviderDisplayName(providerId)} 设置…`,
        `Loading ${ProviderRegistry.getProviderDisplayName(providerId)} settings…`
      ),
    });

    try {
      await ProviderWorkspaceRegistry.ensureInitialized(
        this.plugin.providerHost,
        providerId,
        'settings-tab'
      );
      await ProviderWorkspaceRegistry.prepareSettings(providerId);
      if (displayGeneration !== this.displayGeneration) return;

      targetEl.empty();
      const renderer = ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId);
      if (!renderer) {
        targetEl.createDiv({
          text: featureCopy(
            this.plugin.settings.locale,
            '提供商设置不可用。',
            'Provider settings are unavailable.'
          ),
        });
        return;
      }
      renderer.render(targetEl, {
        plugin: this.plugin.providerHost,
        renderHiddenProviderCommandSetting: (target, targetProviderId, copy) =>
          this.renderHiddenProviderCommandSetting(target, targetProviderId, copy),
        refreshModelSelectors: () => {
          for (const view of this.plugin.getAllViews()) {
            view.refreshModelSelector();
          }
        },
        refreshTitleGenerationModelOptions: () => this.refreshTitleModelOptions?.(),
        renderCustomContextLimits: (target, targetProviderId) =>
          this.renderCustomContextLimits(target, targetProviderId),
      });
    } catch (error) {
      if (displayGeneration !== this.displayGeneration) return;
      targetEl.empty();
      const message = error instanceof Error ? error.message : 'Unknown error';
      targetEl.createDiv({
        cls: 'claudian-plus-setting-validation claudian-plus-setting-validation-error',
        text: featureCopy(
          this.plugin.settings.locale,
          `无法加载提供商设置：${message}`,
          `Could not load provider settings: ${message}`
        ),
      });
    }
  }

  // --- Category: Agents & Skills ---
  private renderAgentsSkillsCategory(container: HTMLElement): void {
    const card = this.createCard(container);
    new WorkspaceResourcesSettings(card, {
      app: this.app,
      plugin: this.plugin,
      coordinator: this.agentSkillCoordinator,
      onSettingsChange: () => this.restartServiceForPromptChange(),
    });
  }

  // --- Category: Workspace ---
  private renderWorkspaceCategory(container: HTMLElement): void {
    const card = this.createCard(container, t('settings.category.workspace') || 'Workspace');

    // Excluded tags
    const tagsSetting = new Setting(card)
      .setName(t('settings.excludedTags.name'))
      .setDesc(t('settings.excludedTags.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('System\nprivate\ndraft')
          .setValue(this.plugin.settings.excludedTags.join('\n'))
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.excludedTags = value
                .split(/\r?\n/)
                .map((entry) => entry.trim().replace(/^#/, ''))
                .filter((entry) => entry.length > 0);
            });
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
    this.registerSearchEntry({
      categoryId: 'workspace',
      categoryLabel: 'Workspace',
      settingKey: 'excluded-tags',
      name: t('settings.excludedTags.name'),
      desc: t('settings.excludedTags.desc'),
      targetEl: tagsSetting.settingEl,
    });

    // Media folder
    const mediaSetting = new Setting(card)
      .setName(t('settings.mediaFolder.name'))
      .setDesc(t('settings.mediaFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder('Attachments')
          .setValue(this.plugin.settings.mediaFolder)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.mediaFolder = value.trim();
            });
          });
        text.inputEl.addClass('claudian-plus-settings-media-input');
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });
    this.registerSearchEntry({
      categoryId: 'workspace',
      categoryLabel: 'Workspace',
      settingKey: 'media-folder',
      name: t('settings.mediaFolder.name'),
      desc: t('settings.mediaFolder.desc'),
      targetEl: mediaSetting.settingEl,
    });

    // Shared Environment Section
    const envCard = this.createCard(container);
    renderEnvironmentSettingsSection({
      container: envCard,
      plugin: this.plugin.providerHost,
      scope: 'shared',
      heading: t('settings.environment'),
      name: featureCopy(this.plugin.settings.locale, '共享环境变量', 'Shared environment'),
      desc: featureCopy(
        this.plugin.settings.locale,
        '供所有提供商共享的运行时变量。可用于 PATH、代理、证书和临时目录配置。',
        'Provider-neutral runtime variables shared across all providers. Use this for PATH, proxy, cert, and temp variables.'
      ),
      placeholder: featureCopy(
        this.plugin.settings.locale,
        'PATH=C:\\Tools;C:\\Program Files\\NodeJS\nHTTPS_PROXY=http://127.0.0.1:7890\nSSL_CERT_FILE=C:\\certs\\ca.pem',
        'PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem'
      ),
      renderCustomContextLimits: (target) => this.renderCustomContextLimits(target),
    });
  }

  // --- Category: Advanced ---
  private renderAdvancedCategory(container: HTMLElement): void {
    const inputCard = this.createCard(container, t('settings.input'));

    const cmdEnterSetting = new Setting(inputCard)
      .setName(t('settings.requireCommandOrControlEnterToSend.name'))
      .setDesc(t('settings.requireCommandOrControlEnterToSend.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.requireCommandOrControlEnterToSend ?? false)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.requireCommandOrControlEnterToSend = value;
            });
          });
      });
    this.registerSearchEntry({
      categoryId: 'advanced',
      categoryLabel: 'Advanced',
      settingKey: 'require-cmd-enter',
      name: t('settings.requireCommandOrControlEnterToSend.name'),
      desc: t('settings.requireCommandOrControlEnterToSend.desc'),
      targetEl: cmdEnterSetting.settingEl,
    });

    const navSetting = new Setting(inputCard)
      .setName(t('settings.navMappings.name'))
      .setDesc(t('settings.navMappings.desc'))
      .addTextArea((text) => {
        let pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
        let saveTimeout: number | null = null;

        const commitValue = async (showError: boolean): Promise<void> => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
          }

          const result = parseNavMappings(pendingValue);
          if (!result.settings) {
            if (showError) {
              new Notice(`${t('common.error')}: ${result.error}`);
              pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
              text.setValue(pendingValue);
            }
            return;
          }

          await this.plugin.mutateSettings((settings) => {
            settings.keyboardNavigation.scrollUpKey = result.settings!.scrollUp;
            settings.keyboardNavigation.scrollDownKey = result.settings!.scrollDown;
            settings.keyboardNavigation.focusInputKey = result.settings!.focusInput;
          });
          pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
          text.setValue(pendingValue);
        };

        const scheduleSave = (): void => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
          }
          saveTimeout = window.setTimeout(() => {
            void commitValue(false);
          }, 500);
        };

        text
          .setPlaceholder('Map w scrollup\nmap s scrolldown\nmap i focusinput')
          .setValue(pendingValue)
          .onChange((value) => {
            pendingValue = value;
            scheduleSave();
          });

        text.inputEl.rows = 3;
        text.inputEl.addEventListener('blur', () => {
          void commitValue(true);
        });
      });
    this.registerSearchEntry({
      categoryId: 'advanced',
      categoryLabel: 'Advanced',
      settingKey: 'nav-mappings',
      name: t('settings.navMappings.name'),
      desc: t('settings.navMappings.desc'),
      targetEl: navSetting.settingEl,
    });

    // Hotkeys
    const hotkeyCard = this.createCard(container, t('settings.hotkeys'));
    const hotkeyGrid = hotkeyCard.createDiv({ cls: 'claudian-plus-hotkey-grid' });
    const commandPrefix = `${this.plugin.manifest.id}:`;
    addHotkeySettingRow(hotkeyGrid, this.app, `${commandPrefix}open-view`, 'settings.openChatHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, `${commandPrefix}new-session`, 'settings.newSessionHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, `${commandPrefix}new-tab`, 'settings.newTabHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, `${commandPrefix}close-current-tab`, 'settings.closeTabHotkey');

    // About Card
    const aboutCard = this.createCard(container);
    aboutCard.addClass('claudian-plus-about-card');
    aboutCard.createDiv({ cls: 'claudian-plus-about-title', text: 'Claudian Plus' });
    aboutCard.createDiv({ cls: 'claudian-plus-about-version', text: `v${this.plugin.manifest.version}` });
    aboutCard.createDiv({
      cls: 'claudian-plus-about-desc',
      text: '以 Codex / Claude 为核心的 Obsidian 本地 AI 智能工作区与代理平台。支持多 Provider 驱动、内存与意识网络、内联代码编辑及模态控制。',
    });

    const btnRow = aboutCard.createDiv({ cls: 'claudian-plus-sp-modal-buttons' });
    const repoBtn = btnRow.createEl('button', { text: 'GitHub 仓库' });
    repoBtn.addEventListener('click', () => {
      window.open('https://github.com/wuyifan-code/Claudian-plus', '_blank');
    });
  }

  private renderHiddenProviderCommandSetting(
    container: HTMLElement,
    providerId: ProviderId,
    copy: { name: string; desc: string; placeholder: string }
  ): void {
    new Setting(container)
      .setName(copy.name)
      .setDesc(copy.desc)
      .addTextArea((text) => {
        text
          .setPlaceholder(copy.placeholder)
          .setValue(getHiddenProviderCommands(this.plugin.settings, providerId).join('\n'))
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.hiddenProviderCommands = {
                ...settings.hiddenProviderCommands,
                [providerId]: normalizeHiddenCommandList(value.split(/\r?\n/)),
              };
            });
            this.plugin.getView()?.updateHiddenProviderCommands();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });
  }

  private renderCustomContextLimits(container: HTMLElement, providerId?: ProviderId): void {
    container.empty();

    const uniqueModelIds = new Set<string>();
    const providerIds = providerId ? [providerId] : ProviderRegistry.getRegisteredProviderIds();

    for (const targetProviderId of providerIds) {
      const envVars = parseEnvironmentVariables(
        this.plugin.getActiveEnvironmentVariables(targetProviderId)
      );
      for (const modelId of ProviderRegistry.getChatUIConfig(targetProviderId).getCustomModelIds(envVars)) {
        uniqueModelIds.add(modelId);
      }
    }

    if (uniqueModelIds.size === 0) {
      return;
    }

    const headerEl = container.createDiv({ cls: 'claudian-plus-context-limits-header' });
    headerEl.createSpan({
      text: t('settings.customModelOverrides.name'),
      cls: 'claudian-plus-context-limits-label',
    });

    const descEl = container.createDiv({ cls: 'claudian-plus-context-limits-desc' });
    descEl.setText(t('settings.customModelOverrides.desc'));

    const listEl = container.createDiv({ cls: 'claudian-plus-context-limits-list' });

    for (const modelId of uniqueModelIds) {
      const currentValue = this.plugin.settings.customContextLimits?.[modelId];
      const currentAlias = this.plugin.settings.customModelAliases?.[modelId] ?? '';

      const itemEl = listEl.createDiv({ cls: 'claudian-plus-context-limits-item' });
      const nameEl = itemEl.createDiv({ cls: 'claudian-plus-context-limits-model' });
      nameEl.setText(modelId);

      const inputWrapper = itemEl.createDiv({ cls: 'claudian-plus-context-limits-input-wrapper' });
      const aliasInputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: t('settings.customModelAliases.placeholder'),
        cls: 'claudian-plus-context-alias-input',
        value: currentAlias,
      });
      aliasInputEl.setAttribute('aria-label', `Alias for ${modelId}`);
      aliasInputEl.title = 'Custom label shown in the model selector. Leave empty to use the default.';

      const inputEl = inputWrapper.createEl('input', {
        type: 'text',
        placeholder: '200k',
        cls: 'claudian-plus-context-limits-input',
        value: currentValue ? formatContextLimit(currentValue) : '',
      });
      inputEl.setAttribute('aria-label', `Context window for ${modelId}`);

      const validationEl = inputWrapper.createDiv({
        cls: 'claudian-plus-context-limit-validation claudian-plus-hidden',
      });

      const saveAlias = async (): Promise<void> => {
        const existing = this.plugin.settings.customModelAliases[modelId] ?? '';
        const trimmed = aliasInputEl.value.trim();
        if (trimmed === existing) {
          aliasInputEl.value = existing;
          return;
        }

        await this.plugin.mutateSettings((settings) => {
          settings.customModelAliases ??= {};
          if (trimmed) {
            settings.customModelAliases[modelId] = trimmed;
          } else {
            delete settings.customModelAliases[modelId];
          }
        });
        for (const view of this.plugin.getAllViews()) {
          view.refreshModelSelector();
        }
      };

      const saveContextLimit = async (): Promise<void> => {
        const trimmed = inputEl.value.trim();

        if (!trimmed) {
          validationEl.toggleClass('claudian-plus-hidden', true);
          inputEl.classList.remove('claudian-plus-input-error');
        } else {
          const parsed = parseContextLimit(trimmed);
          if (parsed === null) {
            validationEl.setText(t('settings.customContextLimits.invalid'));
            validationEl.toggleClass('claudian-plus-hidden', false);
            inputEl.classList.add('claudian-plus-input-error');
            return;
          }

          validationEl.toggleClass('claudian-plus-hidden', true);
          inputEl.classList.remove('claudian-plus-input-error');
        }
        await this.plugin.mutateSettings((settings) => {
          settings.customContextLimits ??= {};
          if (!trimmed) {
            delete settings.customContextLimits[modelId];
          } else {
            settings.customContextLimits[modelId] = parseContextLimit(trimmed)!;
          }
        });
      };

      inputEl.addEventListener('input', () => {
        void saveContextLimit();
      });
      aliasInputEl.addEventListener('blur', () => {
        void saveAlias();
      });
      aliasInputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          aliasInputEl.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          aliasInputEl.value = this.plugin.settings.customModelAliases?.[modelId] ?? '';
          aliasInputEl.blur();
        }
      });
    }
  }

  private async restartServiceForPromptChange(): Promise<void> {
    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();
    if (!tabManager) return;

    try {
      await tabManager.broadcastToAllTabs(async (service) => {
        await service.ensureReady({ force: true });
      });
    } catch {
      // Changes will apply on the next conversation if the restart fails.
    }
  }
}
