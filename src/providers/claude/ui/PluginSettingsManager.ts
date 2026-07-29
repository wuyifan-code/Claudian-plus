import { Notice, setIcon } from 'obsidian';

import type {
  AppAgentManager,
  AppPluginManager,
} from '../../../core/providers/types';
import { isNotifiedMutationError } from '../../../core/storage/NotifiedMutationError';
import type { PluginInfo } from '../../../core/types';
import { localeText } from '../../../i18n/i18n';

export interface PluginSettingsManagerDeps {
  pluginManager: AppPluginManager;
  agentManager: Pick<AppAgentManager, 'loadAgents'>;
  restartTabs: () => Promise<void>;
}

export class PluginSettingsManager {
  private containerEl: HTMLElement;
  private pluginManager: AppPluginManager;
  private agentManager: Pick<AppAgentManager, 'loadAgents'>;
  private restartTabs: () => Promise<void>;

  constructor(containerEl: HTMLElement, deps: PluginSettingsManagerDeps) {
    this.containerEl = containerEl;
    this.pluginManager = deps.pluginManager;
    this.agentManager = deps.agentManager;
    this.restartTabs = deps.restartTabs;
    this.render();
  }

  private render() {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-plus-plugin-header' });
    headerEl.createSpan({ text: localeText('Claude Code 插件', 'Claude Code Plugins'), cls: 'claudian-plus-plugin-label' });

    const refreshBtn = headerEl.createEl('button', {
      cls: 'claudian-plus-settings-action-btn',
      attr: { 'aria-label': localeText('刷新', 'Refresh') },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => {
      void this.refreshPlugins();
    });

    const plugins = this.pluginManager.getPlugins();

    if (plugins.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'claudian-plus-plugin-empty' });
      emptyEl.setText(localeText('未找到 Claude Code 插件。请通过 Claude CLI 启用插件。', 'No Claude code plugins found. Enable plugins via the Claude CLI.'));
      return;
    }

    const projectPlugins = plugins.filter(p => p.scope === 'project');
    const userPlugins = plugins.filter(p => p.scope === 'user');

    const listEl = this.containerEl.createDiv({ cls: 'claudian-plus-plugin-list' });

    if (projectPlugins.length > 0) {
      const sectionHeader = listEl.createDiv({ cls: 'claudian-plus-plugin-section-header' });
      sectionHeader.setText(localeText('项目插件', 'Project plugins'));

      for (const plugin of projectPlugins) {
        this.renderPluginItem(listEl, plugin);
      }
    }

    if (userPlugins.length > 0) {
      const sectionHeader = listEl.createDiv({ cls: 'claudian-plus-plugin-section-header' });
      sectionHeader.setText(localeText('用户插件', 'User plugins'));

      for (const plugin of userPlugins) {
        this.renderPluginItem(listEl, plugin);
      }
    }
  }

  private renderPluginItem(listEl: HTMLElement, plugin: PluginInfo) {
    const itemEl = listEl.createDiv({ cls: 'claudian-plus-plugin-item' });
    if (!plugin.enabled) {
      itemEl.addClass('claudian-plus-plugin-item-disabled');
    }

    const statusEl = itemEl.createDiv({ cls: 'claudian-plus-plugin-status' });
    if (plugin.enabled) {
      statusEl.addClass('claudian-plus-plugin-status-enabled');
    } else {
      statusEl.addClass('claudian-plus-plugin-status-disabled');
    }

    const infoEl = itemEl.createDiv({ cls: 'claudian-plus-plugin-info' });

    const nameRow = infoEl.createDiv({ cls: 'claudian-plus-plugin-name-row' });

    const nameEl = nameRow.createSpan({ cls: 'claudian-plus-plugin-name' });
    nameEl.setText(plugin.name);

    const actionsEl = itemEl.createDiv({ cls: 'claudian-plus-plugin-actions' });

    const toggleBtn = actionsEl.createEl('button', {
      cls: 'claudian-plus-plugin-action-btn',
      attr: { 'aria-label': plugin.enabled ? localeText('禁用', 'Disable') : localeText('启用', 'Enable') },
    });
    setIcon(toggleBtn, plugin.enabled ? 'toggle-right' : 'toggle-left');
    toggleBtn.addEventListener('click', () => {
      void this.togglePlugin(plugin.id);
    });
  }

  private async togglePlugin(pluginId: string) {
    const plugin = this.pluginManager.getPlugins().find(p => p.id === pluginId);
    const wasEnabled = plugin?.enabled ?? false;
    let didPersistToggle = false;

    try {
      await this.pluginManager.togglePlugin(pluginId);
      didPersistToggle = true;
      await this.agentManager.loadAgents();

      try {
        await this.restartTabs();
      } catch {
        new Notice(localeText('插件状态已切换，但部分标签页重启失败。', 'Plugin toggled, but some tabs failed to restart.'));
      }

      new Notice(wasEnabled
        ? localeText(`插件“${pluginId}”已禁用`, `Plugin "${pluginId}" disabled`)
        : localeText(`插件“${pluginId}”已启用`, `Plugin "${pluginId}" enabled`));
    } catch (err) {
      if (didPersistToggle) {
        try {
          await this.pluginManager.togglePlugin(pluginId);
        } catch (rollbackError) {
          if (!isNotifiedMutationError(rollbackError)) {
            const message = rollbackError instanceof Error ? rollbackError.message : localeText('未知错误', 'Unknown error');
            new Notice(localeText(`回滚插件状态失败：${message}`, `Failed to roll back plugin toggle: ${message}`));
          }
          return;
        }
      }
      if (!isNotifiedMutationError(err)) {
        const message = err instanceof Error ? err.message : localeText('未知错误', 'Unknown error');
        new Notice(localeText(`切换插件状态失败：${message}`, `Failed to toggle plugin: ${message}`));
      }
    } finally {
      this.render();
    }
  }

  private async refreshPlugins() {
    try {
      await this.pluginManager.loadPlugins();
      await this.agentManager.loadAgents();

      new Notice(localeText('插件列表已刷新', 'Plugin list refreshed'));
    } catch (err) {
      const message = err instanceof Error ? err.message : localeText('未知错误', 'Unknown error');
      new Notice(localeText(`刷新插件列表失败：${message}`, `Failed to refresh plugins: ${message}`));
    } finally {
      this.render();
    }
  }

  public refresh() {
    this.render();
  }
}
