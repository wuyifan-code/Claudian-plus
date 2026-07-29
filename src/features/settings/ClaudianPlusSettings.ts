import path from 'node:path';

import type { App, Plugin } from 'obsidian';
import { Notice, Platform, PluginSettingTab, Setting } from 'obsidian';

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
import { createProviderIconSvg } from '../../shared/icons';
import { FileViewerModal } from '../../shared/modals/FileViewerModal';
import { AgentSkillSettings } from '../../shared/settings/AgentSkillSettings';
import { renderEnvironmentSettingsSection } from '../../shared/settings/EnvironmentSettingsSection';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import type { FeatureHost } from '../FeatureHost';
import { AgentSkillManagementCoordinator } from './AgentSkillManagementCoordinator';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';

type SettingsTabId = 'general' | 'providers' | 'workspace' | 'about';
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
  private activeTab: SettingsTabId = 'general';
  private selectedProviderId: ProviderId = 'claude';
  private refreshTitleModelOptions: (() => void) | null = null;
  private displayGeneration = 0;
  private readonly agentSkillCoordinator: AgentSkillManagementCoordinator;

  constructor(app: App, plugin: FeatureHost & Plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.agentSkillCoordinator = new AgentSkillManagementCoordinator(
      plugin.getAgentSkillRepository(),
      () => plugin.notifyAgentSkillsChanged(),
    );
  }

  /**
   * Declarative settings definitions for Obsidian 1.13.0+ settings search.
   * Claudian Plus still builds its settings imperatively in display(); this empty
   * array satisfies the contract so the tab is registered in search.
   */
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

    setLocale(this.plugin.settings.locale as Locale);

    const mainTabs: { id: SettingsTabId; label: string }[] = [
      { id: 'general', label: featureCopy(this.plugin.settings.locale, '通用', 'General') },
      { id: 'providers', label: featureCopy(this.plugin.settings.locale, '提供商', 'Providers') },
      { id: 'workspace', label: featureCopy(this.plugin.settings.locale, '工作区', 'Workspace') },
      { id: 'about', label: featureCopy(this.plugin.settings.locale, '关于', 'About') },
    ];

    const tabIds = mainTabs.map((t) => t.id);
    if (!tabIds.includes(this.activeTab)) {
      this.activeTab = 'general';
    }

    const tabBar = containerEl.createDiv({ cls: 'claudian-plus-settings-tabs' });
    const tabButtons = new Map<SettingsTabId, HTMLButtonElement>();
    const tabContents = new Map<SettingsTabId, HTMLDivElement>();

    const renderProviderTab = async (providerId: ProviderId, targetEl: HTMLElement): Promise<void> => {
      targetEl.empty();
      targetEl.createDiv({
        cls: 'claudian-plus-settings-provider-loading',
        text: featureCopy(
          this.plugin.settings.locale,
          `正在加载 ${ProviderRegistry.getProviderDisplayName(providerId)} 设置…`,
          `Loading ${ProviderRegistry.getProviderDisplayName(providerId)} settings…`,
        ),
      });

      try {
        await ProviderWorkspaceRegistry.ensureInitialized(
          this.plugin.providerHost,
          providerId,
          'settings-tab',
        );
        await ProviderWorkspaceRegistry.prepareSettings(providerId);
        if (displayGeneration !== this.displayGeneration) {
          return;
        }

        targetEl.empty();
        const renderer = ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId);
        if (!renderer) {
          targetEl.createDiv({
            text: featureCopy(this.plugin.settings.locale, '提供商设置不可用。', 'Provider settings are unavailable.'),
          });
          return;
        }
        renderer.render(targetEl, {
          plugin: this.plugin.providerHost,
          renderHiddenProviderCommandSetting: (
            target,
            targetProviderId,
            copy,
          ) => this.renderHiddenProviderCommandSetting(target, targetProviderId, copy),
          refreshModelSelectors: () => {
            for (const view of this.plugin.getAllViews()) {
              view.refreshModelSelector();
            }
          },
          refreshTitleGenerationModelOptions: () => this.refreshTitleModelOptions?.(),
          renderCustomContextLimits: (target, targetProviderId) => (
            this.renderCustomContextLimits(target, targetProviderId)
          ),
        });
      } catch (error) {
        if (displayGeneration !== this.displayGeneration) {
          return;
        }
        targetEl.empty();
        const message = error instanceof Error ? error.message : 'Unknown error';
        targetEl.createDiv({
          cls: 'claudian-plus-setting-validation claudian-plus-setting-validation-error',
          text: featureCopy(
            this.plugin.settings.locale,
            `无法加载提供商设置：${message}`,
            `Could not load provider settings: ${message}`,
          ),
        });
      }
    };

    for (const tabItem of mainTabs) {
      const button = tabBar.createEl('button', {
        cls: `claudian-plus-settings-tab${tabItem.id === this.activeTab ? ' claudian-plus-settings-tab--active' : ''}`,
        text: tabItem.label,
      });
      button.addEventListener('click', () => {
        this.activeTab = tabItem.id;
        for (const id of tabIds) {
          tabButtons.get(id)?.toggleClass('claudian-plus-settings-tab--active', id === tabItem.id);
          tabContents.get(id)?.toggleClass('claudian-plus-settings-tab-content--active', id === tabItem.id);
        }
      });
      tabButtons.set(tabItem.id, button);
    }

    for (const id of tabIds) {
      const content = containerEl.createDiv({
        cls: `claudian-plus-settings-tab-content${id === this.activeTab ? ' claudian-plus-settings-tab-content--active' : ''}`,
      });
      tabContents.set(id, content);
    }

    this.renderGeneralTab(tabContents.get('general')!);
    this.renderProvidersTab(tabContents.get('providers')!, (id, target) => renderProviderTab(id, target));
    this.renderWorkspaceTab(tabContents.get('workspace')!);
    this.renderAboutTab(tabContents.get('about')!);
  }

  private createCard(container: HTMLElement, title?: string): HTMLElement {
    const card = container.createDiv({ cls: 'claudian-plus-settings-card' });
    if (title) {
      card.createDiv({ cls: 'claudian-plus-settings-card-header', text: title });
    }
    return card;
  }

  private renderProvidersTab(
    container: HTMLElement,
    renderProviderTabFn: (id: ProviderId, target: HTMLElement) => Promise<void>,
  ): void {
    // 1. Default Provider Selection Card
    const defaultProviderCard = this.createCard(container);
    new Setting(defaultProviderCard)
      .setName('默认提供商')
      .setDesc('选择全局创建新聊天面板时的默认 AI 提供商')
      .addDropdown((dropdown) => {
        dropdown.addOption('auto', '跟随所选模型');
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

    // 2. Provider Pill Bar Selector (Horizontal capsule buttons with SVG icons)
    const registeredIds = ProviderRegistry.getRegisteredProviderIds();
    const allProviders = registeredIds.map((id) => ({
      id,
      name: ProviderRegistry.getProviderDisplayName(id),
    }));

    if (!this.selectedProviderId || !registeredIds.includes(this.selectedProviderId)) {
      this.selectedProviderId = registeredIds[0] || 'claude';
    }

    const selectorCard = this.createCard(container);
    const pillBar = selectorCard.createDiv({ cls: 'claudian-plus-provider-pill-bar' });
    const pillElements = new Map<ProviderId, HTMLElement>();

    // 3. Selected Provider Settings Detail Card
    const initialProviderName = ProviderRegistry.getProviderDisplayName(this.selectedProviderId);
    const providerDetailCard = this.createCard(container, `${initialProviderName} 设置`);
    const detailCardHeader = providerDetailCard.querySelector('.claudian-plus-settings-card-header') as HTMLElement;
    const providerContentArea = providerDetailCard.createDiv({ cls: 'claudian-plus-provider-settings-content' });

    const updateDetailArea = (id: ProviderId) => {
      const pName = ProviderRegistry.getProviderDisplayName(id);
      if (detailCardHeader) {
        detailCardHeader.setText(`${pName} 设置`);
      }
      providerContentArea.empty();
      void renderProviderTabFn(id, providerContentArea);
    };

    for (const p of allProviders) {
      const isSelected = p.id === this.selectedProviderId;

      const pill = pillBar.createDiv({
        cls: `claudian-plus-provider-pill${isSelected ? ' claudian-plus-provider-pill--active' : ''}`,
      });
      pillElements.set(p.id, pill);

      // Render Provider SVG Icon
      const iconEl = pill.createDiv({ cls: 'claudian-plus-provider-pill-icon' });
      const iconSvg = ProviderRegistry.getChatUIConfig(p.id).getProviderIcon?.();
      if (iconSvg) {
        createProviderIconSvg(iconSvg, { parent: iconEl });
      }

      // Provider Name
      pill.createSpan({ cls: 'claudian-plus-provider-pill-name', text: p.name });

      // Click to select provider pill
      pill.addEventListener('click', () => {
        if (this.selectedProviderId === p.id) return;
        this.selectedProviderId = p.id;
        for (const [id, el] of pillElements.entries()) {
          el.toggleClass('claudian-plus-provider-pill--active', id === p.id);
        }
        updateDetailArea(p.id);
      });
    }

    // Initial render of active provider detail settings
    updateDetailArea(this.selectedProviderId);
  }

  private renderGeneralTab(container: HTMLElement): void {
    // --- Language & Core ---
    const langCard = this.createCard(container);
    new Setting(langCard)
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

    // --- Display ---
    const displayCard = this.createCard(container, t('settings.display'));

    const maxTabsSetting = new Setting(displayCard)
      .setName(t('settings.maxTabs.name'))
      .setDesc(t('settings.maxTabs.desc'));

    const maxTabsWarningEl = displayCard.createDiv({
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

    new Setting(displayCard)
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

    new Setting(displayCard)
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

    new Setting(displayCard)
      .setName(t('settings.livePreviewComposer.name'))
      .setDesc(t('settings.livePreviewComposer.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableLivePreviewComposer ?? true)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.enableLivePreviewComposer = value;
            });
          })
      );

    new Setting(displayCard)
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

    new Setting(displayCard)
      .setName(featureCopy(this.plugin.settings.locale, '悬浮大纲样式', 'Outline style'))
      .setDesc(featureCopy(
        this.plugin.settings.locale,
        '选择聊天侧边栏中悬浮大纲标记的显示样式。',
        'Choose the floating outline marker style in the conversation sidebar.',
      ))
      .addDropdown((dropdown) => {
        dropdown
          .addOption('bar', 'Bars (horizontal ticks)')
          .addOption('dot', 'Dots (circles with wave focus)')
          .setValue(this.plugin.settings.outlineStyle ?? 'bar')
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.outlineStyle = value as 'bar' | 'dot';
            });
            // Refresh open views so the outline style takes effect immediately.
            for (const view of this.plugin.getAllViews()) {
              view.refreshOutlineStyle?.();
            }
          });
      });

    new Setting(displayCard)
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

    new Setting(displayCard)
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

    // --- Conversations ---
    const convCard = this.createCard(container, t('settings.conversations'));

    new Setting(convCard)
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

    if (this.plugin.settings.enableAutoTitleGeneration) {
      new Setting(convCard)
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
    }

    // --- Content ---
    const contentCard = this.createCard(container, t('settings.content'));

    new Setting(contentCard)
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

    new Setting(contentCard)
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
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(contentCard)
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

    new Setting(contentCard)
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

    // --- Input ---
    const inputCard = this.createCard(container, t('settings.input'));

    new Setting(inputCard)
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

    new Setting(inputCard)
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

    // --- Hotkeys ---
    const hotkeyCard = this.createCard(container, t('settings.hotkeys'));

    const hotkeyGrid = hotkeyCard.createDiv({ cls: 'claudian-plus-hotkey-grid' });
    const commandPrefix = `${this.plugin.manifest.id}:`;
    addHotkeySettingRow(hotkeyGrid, this.app, `${commandPrefix}inline-edit`, 'settings.inlineEditHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, `${commandPrefix}open-view`, 'settings.openChatHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, `${commandPrefix}new-session`, 'settings.newSessionHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, `${commandPrefix}new-tab`, 'settings.newTabHotkey');
    addHotkeySettingRow(hotkeyGrid, this.app, `${commandPrefix}close-current-tab`, 'settings.closeTabHotkey');
  }

  private renderWorkspaceTab(container: HTMLElement): void {
    // --- Agent Skills ---
    const agentSkillsCard = this.createCard(container);
    new AgentSkillSettings(agentSkillsCard, this.agentSkillCoordinator, this.app);

    // --- Memory ---
    const memoryCard = this.createCard(container, t('settings.memory.heading'));

    new Setting(memoryCard)
      .setName(t('settings.memory.enabled.name'))
      .setDesc(t('settings.memory.enabled.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.memoryEnabled ?? true)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.memoryEnabled = value;
            });
            this.display();
          });
      });

    if (this.plugin.settings.memoryEnabled ?? true) {
      new Setting(memoryCard)
        .setName(t('settings.memory.filePath.name'))
        .setDesc(t('settings.memory.filePath.desc'))
        .addText((text) => {
          text
            .setPlaceholder('.claudian-plus/memory.md')
            .setValue(this.plugin.settings.memoryFilePath)
            .onChange(async (value) => {
              await this.plugin.mutateSettings((settings) => {
                settings.memoryFilePath = value.trim() || '.claudian-plus/memory.md';
              });
            });
          text.inputEl.addEventListener('blur', () => {
            void this.restartServiceForPromptChange();
          });
        });

      new Setting(memoryCard)
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

      // Memory management buttons
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

            new FileViewerModal(this.app, '记忆与沉淀文件', [
              { label: '长期记忆 (memory.md)', path: absolutePath },
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
            void this.restartServiceForPromptChange();
          });
      });
    }

    // --- Consciousness ---
    const consciousnessCard = this.createCard(container, t('settings.consciousness.heading'));

    new Setting(consciousnessCard)
      .setName(t('settings.consciousness.enabled.name'))
      .setDesc(t('settings.consciousness.enabled.desc'))
      .addToggle((toggle) => {
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
          });
      });

    if (this.plugin.settings.consciousnessEnabled ?? false) {
      new Setting(consciousnessCard)
        .setName(t('settings.consciousness.autoMemory.name'))
        .setDesc(t('settings.consciousness.autoMemory.desc'))
        .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.consciousnessAutoMemory ?? false)
          .onChange(async (value) => {
            await this.plugin.mutateSettings((settings) => {
              settings.consciousnessAutoMemory = value;
            });
            this.plugin.getConsciousnessEngine().updateConfig({ autoMemoryEnabled: value });
          });
        });

      // Consciousness management buttons
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

            new FileViewerModal(this.app, '意识网络文件 (Awareness Network)', [
              { label: '用户画像 (USER.md)', path: userPath },
              { label: '协作风格 (SOUL.md)', path: soulPath },
              { label: '活动记录 (activity.json)', path: activityPath },
            ]).open();
          });
      });

      consciousnessButtonSetting.addButton((button) => {
        button
          .setButtonText(t('settings.consciousness.clearBtn'))
          .setWarning()
          .onClick(async () => {
            const engine = this.plugin.getConsciousnessEngine();
            // Clear long-term memory through its own mutation queue first.
            // The consciousness reset then leaves that file alone, so a
            // delayed auto-memory write cannot be deleted after this reset.
            await this.plugin.getMemoryStore().save([]);
            await engine.clearAll(this.plugin.settings.memoryFilePath, {
              clearMemoryFile: false,
            });
            // Vault knowledge is part of the injected awareness context too.
            // Clear both its persisted index and the in-memory cache so reset
            // takes effect immediately, without waiting for a plugin reload.
            await this.plugin.getVaultKnowledgeEngine().clearIndex();
            new Notice('Consciousness data reset');
          });
      });
    }

    // --- Vault knowledge and retrieval ---
    const vaultCard = this.createCard(
      container,
      featureCopy(this.plugin.settings.locale, 'Vault 知识与检索', 'Vault knowledge & retrieval'),
    );
    const guide = vaultCard.createDiv({ cls: 'claudian-plus-settings-feature-guide' });
    guide.createDiv({
      cls: 'claudian-plus-settings-feature-guide-title',
      text: featureCopy(this.plugin.settings.locale, '不知道从哪里开始？', 'Not sure where to start?'),
    });
    guide.createDiv({
      cls: 'claudian-plus-settings-feature-guide-copy',
      text: featureCopy(
        this.plugin.settings.locale,
        '建议先开启“自动 Vault 上下文”，聊天时插件会自动找相关笔记。需要更强的语义匹配时，再开启本地语义检索。记忆和意识功能则只会读取本地 .claudian-plus 文件。',
        'Start with Automatic vault context: Claudian Plus will attach relevant local notes to normal chats. Add Local semantic search only when you have a local embedding service. Memory and awareness data stay in .claudian-plus.',
      ),
    });

    const vaultKnowledgeEnabled = this.plugin.settings.vaultKnowledgeEnabled
      ?? this.plugin.settings.consciousnessEnabled;
    new Setting(vaultCard)
      .setName(featureCopy(this.plugin.settings.locale, '启用 Vault 知识索引', 'Enable vault knowledge index'))
      .setDesc(featureCopy(
        this.plugin.settings.locale,
        '扫描笔记的标题、标签、目录和摘要，生成知识概览并注入对话。不会上传到远程服务。',
        'Index note titles, tags, folders, and excerpts for a compact knowledge summary. Nothing is uploaded by this feature.',
      ))
      .addToggle((toggle) => toggle
        .setValue(vaultKnowledgeEnabled)
        .onChange(async (value) => {
          await this.plugin.mutateSettings((settings) => {
            settings.vaultKnowledgeEnabled = value;
          });
          this.plugin.getVaultKnowledgeEngine().updateConfig({ enabled: value });
          this.display();
        }));

    new Setting(vaultCard)
      .setName(t('settings.vaultAutoContext.name'))
      .setDesc(t('settings.vaultAutoContext.desc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.vaultAutoContextEnabled ?? true)
        .onChange(async (value) => {
          await this.plugin.mutateSettings((settings) => {
            settings.vaultAutoContextEnabled = value;
          });
        }));

    new Setting(vaultCard)
      .setName(featureCopy(this.plugin.settings.locale, '周期性 Vault 回顾', 'Periodic vault review'))
      .setDesc(featureCopy(
        this.plugin.settings.locale,
        '按最近修改的笔记生成 Markdown 回顾，包含重复主题、未完成事项、链接活动和后续问题。',
        'Generate a Markdown review from recently changed notes with recurring topics, open loops, link activity, and follow-up prompts.',
      ))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.vaultReviewEnabled
          ?? this.plugin.settings.consciousnessAutoMemory)
        .onChange(async (value) => {
          await this.plugin.mutateSettings((settings) => {
            settings.vaultReviewEnabled = value;
          });
          this.plugin.vaultReviewService?.updateConfig({ enabled: value });
        }));

    new Setting(vaultCard)
      .setName(t('settings.semanticSearch.name'))
      .setDesc(t('settings.semanticSearch.desc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.semanticSearchEnabled === true)
        .onChange(async (value) => {
          await this.plugin.mutateSettings((settings) => {
            settings.semanticSearchEnabled = value;
          });
          this.plugin.refreshSemanticRetrieval?.();
          this.display();
        }));

    if (this.plugin.settings.semanticSearchEnabled === true) {
      new Setting(vaultCard)
        .setName(t('settings.semanticEmbeddingEndpoint.name'))
        .setDesc(t('settings.semanticEmbeddingEndpoint.desc'))
        .addText((text) => {
          text
            .setPlaceholder('http://127.0.0.1:11434')
            .setValue(this.plugin.settings.semanticEmbeddingEndpoint ?? '')
            .onChange(async (value) => {
              await this.plugin.mutateSettings((settings) => {
                settings.semanticEmbeddingEndpoint = value.trim();
              });
              this.plugin.refreshSemanticRetrieval?.();
            });
        });

      new Setting(vaultCard)
        .setName(t('settings.semanticEmbeddingModel.name'))
        .setDesc(t('settings.semanticEmbeddingModel.desc'))
        .addText((text) => {
          text
            .setPlaceholder('nomic-embed-text')
            .setValue(this.plugin.settings.semanticEmbeddingModel ?? '')
            .onChange(async (value) => {
              await this.plugin.mutateSettings((settings) => {
                settings.semanticEmbeddingModel = value.trim();
              });
              this.plugin.refreshSemanticRetrieval?.();
            });
        });
    }

    new Setting(vaultCard)
      .setName(t('settings.autoLinkRecommendations.name'))
      .setDesc(t('settings.autoLinkRecommendations.desc'))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.vaultAutoLinkRecommendationsEnabled === true)
        .onChange(async (value) => {
          await this.plugin.mutateSettings((settings) => {
            settings.vaultAutoLinkRecommendationsEnabled = value;
          });
        }));

    const vaultActions = new Setting(vaultCard)
      .setName(featureCopy(this.plugin.settings.locale, '立即执行', 'Run now'))
      .setDesc(featureCopy(
        this.plugin.settings.locale,
        '第一次使用前，可以手动建立知识索引或生成一份回顾。之后也可以从命令面板执行。',
        'Build the index or generate a review immediately. Both actions are also available from the command palette.',
      ));
    vaultActions.addButton((button) => {
      button
        .setButtonText(featureCopy(this.plugin.settings.locale, '扫描 Vault', 'Scan vault'))
        .onClick(async () => {
          if (!(this.plugin.settings.vaultKnowledgeEnabled ?? this.plugin.settings.consciousnessEnabled)) {
            new Notice(featureCopy(this.plugin.settings.locale, '请先开启 Vault 知识索引。', 'Enable the vault knowledge index first.'));
            return;
          }
          new Notice(featureCopy(this.plugin.settings.locale, '正在扫描 Vault…', 'Scanning vault…'));
          try {
            const index = await this.plugin.getVaultKnowledgeEngine().scanVault();
            new Notice(featureCopy(
              this.plugin.settings.locale,
              `已索引 ${index.noteCount} 篇笔记。`,
              `Indexed ${index.noteCount} notes.`,
            ));
          } catch (error) {
            new Notice(`${featureCopy(this.plugin.settings.locale, '扫描失败', 'Scan failed')}: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
    });
    vaultActions.addButton((button) => {
      button
        .setButtonText(featureCopy(this.plugin.settings.locale, '生成回顾', 'Generate review'))
        .onClick(async () => {
          const reviewService = this.plugin.vaultReviewService;
          if (!reviewService) return;
          await reviewService.runReview(true);
        });
    });

    // --- Environment ---
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
        'Provider-neutral runtime variables shared across all providers. Use this for PATH, proxy, cert, and temp variables.',
      ),
      placeholder: featureCopy(
        this.plugin.settings.locale,
        'PATH=C:\\Tools;C:\\Program Files\\NodeJS\nHTTPS_PROXY=http://127.0.0.1:7890\nSSL_CERT_FILE=C:\\certs\\ca.pem',
        'PATH=/opt/homebrew/bin:/usr/local/bin\nHTTPS_PROXY=http://proxy.example.com:8080\nSSL_CERT_FILE=/path/to/cert.pem',
      ),
      renderCustomContextLimits: (target) => this.renderCustomContextLimits(target),
    });
  }

  private renderAboutTab(container: HTMLElement): void {
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
    copy: { name: string; desc: string; placeholder: string },
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
    const providerIds = providerId
      ? [providerId]
      : ProviderRegistry.getRegisteredProviderIds();

    for (const targetProviderId of providerIds) {
      const envVars = parseEnvironmentVariables(
        this.plugin.getActiveEnvironmentVariables(targetProviderId),
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

      const validationEl = inputWrapper.createDiv({ cls: 'claudian-plus-context-limit-validation claudian-plus-hidden' });

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
      await tabManager.broadcastToAllTabs(
        async (service) => { await service.ensureReady({ force: true }); }
      );
    } catch {
      // Changes will apply on the next conversation if the restart fails.
    }
  }
}
