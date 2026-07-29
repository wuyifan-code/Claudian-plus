import * as fs from 'fs';
import { Setting } from 'obsidian';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { localeText, t } from '../../../i18n/i18n';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { McpSettingsManager } from '../../../shared/settings/McpSettingsManager';
import { applyProviderEnablementToggle } from '../../../shared/settings/ProviderEnablementToggle';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { getClaudeWorkspaceServices } from '../app/ClaudeWorkspaceServices';
import { resolveClaudeModelSelection } from '../modelOptions';
import {
  CLAUDE_SAFE_MODES,
  type ClaudeSafeMode,
  getClaudeProviderSettings,
  updateClaudeProviderSettings,
} from '../settings';
import { AgentSettings } from './AgentSettings';
import { claudeChatUIConfig } from './ClaudeChatUIConfig';
import { renderClaudeServiceSettings } from './ClaudeServiceSettings';
import { PluginSettingsManager } from './PluginSettingsManager';
import { SlashCommandSettings } from './SlashCommandSettings';

export const claudeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const claudeWorkspace = getClaudeWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const claudeSettings = getClaudeProviderSettings(settingsBag);

    const reconcileActiveClaudeModelSelection = (settings: Record<string, unknown>): void => {
      const activeProvider = settings.settingsProvider;
      if (activeProvider !== undefined && activeProvider !== 'claude') {
        return;
      }

      const currentModel = typeof settings.model === 'string' ? settings.model : '';
      const nextModel = resolveClaudeModelSelection(settings, currentModel);
      if (!nextModel || nextModel === currentModel) {
        return;
      }

      settings.model = nextModel;
      claudeChatUIConfig.applyModelDefaults(nextModel, settings);
    };

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName(t('settings.claude.enableProvider.name'))
      .setDesc(t('settings.claude.enableProvider.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(claudeSettings.enabled)
          .onChange(async (value) => {
            await applyProviderEnablementToggle(context, toggle, 'claude', value);
          })
      );

    const hostnameKey = getHostnameKey();
    const platformDesc = process.platform === 'win32'
      ? t('settings.cliPath.descWindows')
      : t('settings.cliPath.descUnix');
    const cliPathDescription = `${t('settings.cliPath.desc')} ${platformDesc}`;

    const cliPathSetting = new Setting(container)
      .setName(t('settings.cliPath.name'))
      .setDesc(cliPathDescription);

    const validationEl = container.createDiv({
      cls: 'claudian-plus-cli-path-validation claudian-plus-setting-validation claudian-plus-setting-validation-error claudian-plus-hidden',
    });

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;

      const expandedPath = expandHomePath(trimmed);

      if (!fs.existsSync(expandedPath)) {
        return t('settings.cliPath.validation.notExist');
      }
      const stat = fs.statSync(expandedPath);
      if (!stat.isFile()) {
        return t('settings.cliPath.validation.isDirectory');
      }
      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('claudian-plus-hidden', false);
        if (inputEl) {
          inputEl.toggleClass('claudian-plus-input-error', true);
        }
        return false;
      }

      validationEl.toggleClass('claudian-plus-hidden', true);
      if (inputEl) {
        inputEl.toggleClass('claudian-plus-input-error', false);
      }
      return true;
    };

    const currentValue = claudeSettings.cliPathsByHost[hostnameKey] || '';
    const cliPathsByHost = { ...claudeSettings.cliPathsByHost };
    let cliPathInputEl: HTMLInputElement | null = null;

    const persistCliPath = async (value: string): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, cliPathInputEl ?? undefined);
      if (!isValid) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      await context.plugin.mutateSettings((settings) => {
        updateClaudeProviderSettings(settings, { cliPathsByHost: { ...cliPathsByHost } });
      });
      claudeWorkspace.cliResolver.reset();
      await context.plugin.recycleProviderRuntimes?.('claude');
      return true;
    };

    cliPathSetting.addText((text) => {
      const placeholder = process.platform === 'win32'
        ? 'D:\\nodejs\\node_global\\node_modules\\@anthropic-ai\\claude-code\\cli-wrapper.cjs'
        : '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs';

      text
        .setPlaceholder(placeholder)
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('claudian-plus-settings-cli-path-input');
      cliPathInputEl = text.inputEl;

      updateCliPathValidation(currentValue, text.inputEl);
    });

    // --- Safety ---

    new Setting(container).setName(t('settings.safety')).setHeading();

    new Setting(container)
      .setName(t('settings.claudeSafeMode.name'))
      .setDesc(t('settings.claudeSafeMode.desc'))
      .addDropdown((dropdown) => {
        for (const mode of CLAUDE_SAFE_MODES) {
          dropdown.addOption(mode, mode);
        }
        dropdown
          .setValue(claudeSettings.safeMode)
          .onChange(async (value) => {
            await context.plugin.mutateSettings((settings) => {
              updateClaudeProviderSettings(
                settings,
                { safeMode: value as ClaudeSafeMode },
              );
            });
          });
      });

    new Setting(container)
      .setName(t('settings.loadUserSettings.name'))
      .setDesc(t('settings.loadUserSettings.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(claudeSettings.loadUserSettings)
          .onChange(async (value) => {
            await context.plugin.mutateSettings((settings) => {
              updateClaudeProviderSettings(settings, { loadUserSettings: value });
            });
          })
      );

    // --- Models ---

    new Setting(container).setName(t('settings.models')).setHeading();

    new Setting(container)
      .setName(t('settings.customModels.name'))
      .setDesc(t('settings.customModels.desc'))
      .addTextArea((text) => {
        let pendingCustomModels = claudeSettings.customModels;
        let savedCustomModels = claudeSettings.customModels;

        const commitCustomModels = async (): Promise<void> => {
          if (pendingCustomModels === savedCustomModels) {
            return;
          }

          const nextCustomModels = pendingCustomModels;
          await context.plugin.mutateSettings((settings) => {
            updateClaudeProviderSettings(settings, { customModels: nextCustomModels });
            reconcileActiveClaudeModelSelection(settings);
            ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settings);
          });
          savedCustomModels = nextCustomModels;
          context.refreshModelSelectors();
        };

        text
          .setPlaceholder(t('settings.customModels.placeholder'))
          .setValue(claudeSettings.customModels)
          .onChange((value) => {
            pendingCustomModels = value;
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 40;
        text.inputEl.addEventListener('blur', () => {
          void commitCustomModels();
        });
      });

    // --- Third-party Claude-compatible services ---

    renderClaudeServiceSettings(container, context);

    // --- Slash Commands ---

    new Setting(container).setName(t('settings.slashCommands.name')).setHeading();

    const slashCommandsDesc = container.createDiv({ cls: 'claudian-plus-sp-settings-desc' });
    const descP = slashCommandsDesc.createEl('p', { cls: 'setting-item-description' });
    descP.appendText(t('settings.slashCommands.desc') + ' ');
    descP.createEl('a', {
      text: localeText('了解更多', 'Learn more'),
      href: 'https://code.claude.com/docs/en/skills',
    });

    const slashCommandsContainer = container.createDiv({ cls: 'claudian-plus-slash-commands-container' });
    new SlashCommandSettings(
      slashCommandsContainer,
      context.plugin.app,
      claudeWorkspace.commandCatalog,
    );

    context.renderHiddenProviderCommandSetting(container, 'claude', {
      name: t('settings.hiddenSlashCommands.name'),
      desc: t('settings.hiddenSlashCommands.desc'),
      placeholder: t('settings.hiddenSlashCommands.placeholder'),
    });

    // --- Subagents ---

    new Setting(container).setName(t('settings.subagents.name')).setHeading();

    const agentsDesc = container.createDiv({ cls: 'claudian-plus-sp-settings-desc' });
    agentsDesc.createEl('p', {
      text: t('settings.subagents.desc'),
      cls: 'setting-item-description',
    });

    const agentsContainer = container.createDiv({ cls: 'claudian-plus-agents-container' });
    new AgentSettings(agentsContainer, {
      app: context.plugin.app,
      agentManager: claudeWorkspace.agentManager,
      agentStorage: claudeWorkspace.agentStorage,
    });

    // --- MCP Servers ---

    new Setting(container).setName(t('settings.mcpServers.name')).setHeading();

    const mcpDesc = container.createDiv({ cls: 'claudian-plus-mcp-settings-desc' });
    mcpDesc.createEl('p', {
      text: t('settings.mcpServers.desc'),
      cls: 'setting-item-description',
    });

    const mcpContainer = container.createDiv({ cls: 'claudian-plus-mcp-container' });
    new McpSettingsManager(mcpContainer, {
      app: context.plugin.app,
      mcpStorage: claudeWorkspace.mcpStorage,
      broadcastMcpReload: async () => {
        await context.plugin.broadcastToAllViewRuntimes?.(
          (service) => service.reloadMcpServers(),
        );
      },
    });

    // --- Plugins ---

    new Setting(container).setName(t('settings.plugins.name')).setHeading();

    const pluginsDesc = container.createDiv({ cls: 'claudian-plus-plugin-settings-desc' });
    pluginsDesc.createEl('p', {
      text: t('settings.plugins.desc'),
      cls: 'setting-item-description',
    });

    const pluginsContainer = container.createDiv({ cls: 'claudian-plus-plugins-container' });
    new PluginSettingsManager(pluginsContainer, {
      pluginManager: claudeWorkspace.pluginManager,
      agentManager: claudeWorkspace.agentManager,
      restartTabs: async () => {
        await context.plugin.broadcastToActiveViewRuntimes?.(
          async (service) => { await service.ensureReady({ force: true }); },
        );
      },
    });

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:claude',
      heading: t('settings.environment'),
      name: t('settings.customVariables.name'),
      desc: localeText('仅供 Claude 使用的运行时变量。用于 ANTHROPIC_* 和 Claude 专属开关。', 'Claude-owned runtime variables only. Use this for ANTHROPIC_* and Claude-specific toggles.'),
      placeholder: 'ANTHROPIC_API_KEY=your-key\nANTHROPIC_BASE_URL=https://api.example.com\nANTHROPIC_MODEL=custom-model\nCLAUDE_CODE_USE_BEDROCK=1',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'claude'),
    });

    // --- Experimental ---

    new Setting(container).setName(t('settings.experimental')).setHeading();

    new Setting(container)
      .setName(t('settings.enableChrome.name'))
      .setDesc(t('settings.enableChrome.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(claudeSettings.enableChrome)
          .onChange(async (value) => {
            await context.plugin.mutateSettings((settings) => {
              updateClaudeProviderSettings(settings, { enableChrome: value });
            });
          })
      );

    new Setting(container)
      .setName(t('settings.enableBangBash.name'))
      .setDesc(t('settings.enableBangBash.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(claudeSettings.enableBangBash)
          .onChange(async (value) => {
            bangBashValidationEl.toggleClass('claudian-plus-hidden', true);
            if (value) {
              const { findNodeExecutable, getEnhancedPath } = await import('../../../utils/env');
              const nodePath = findNodeExecutable(getEnhancedPath());
              if (!nodePath) {
                bangBashValidationEl.setText(t('settings.enableBangBash.validation.noNode'));
                bangBashValidationEl.toggleClass('claudian-plus-hidden', false);
                toggle.setValue(false);
                return;
              }
            }
            await context.plugin.mutateSettings((settings) => {
              updateClaudeProviderSettings(settings, { enableBangBash: value });
            });
          })
      );

    const bangBashValidationEl = container.createDiv({
      cls: 'claudian-plus-bang-bash-validation claudian-plus-setting-validation claudian-plus-setting-validation-error claudian-plus-hidden',
    });
  },
};
