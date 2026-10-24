import { type ButtonComponent, Notice, Setting } from 'obsidian';

import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { localeText } from '../../../i18n/i18n';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { applyProviderEnablementToggle } from '../../../shared/settings/ProviderEnablementToggle';
import { getHostnameKey } from '../../../utils/env';
import { getDshProviderSettings, updateDshProviderSettings } from '../settings';

export const dshSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settings = context.plugin.settings as unknown as Record<string, unknown>;
    const current = getDshProviderSettings(settings);
    let refreshButton: ButtonComponent | undefined;
    new Setting(container)
      .setName(localeText('启用 DeepSeek Harness', 'Enable DeepSeek Harness'))
      .setDesc(localeText('使用已安装的 DeepSeek Harness CLI 及其原生配置。', 'Use the installed DeepSeek Harness CLI and its native configuration.'))
      .addToggle(toggle => toggle.setValue(current.enabled).onChange(async value => {
        await applyProviderEnablementToggle(context, toggle, 'dsh', value);
        refreshButton?.setDisabled(!getDshProviderSettings(settings).enabled);
      }));

    new Setting(container)
      .setName(localeText('CLI 路径', 'CLI path'))
      .setDesc(localeText('此电脑上的可选 CLI 路径。留空则使用 PATH 中的 dsh。', 'Optional DeepSeek Harness executable path for this computer. Leave empty to use dsh from PATH.'))
      .addText(text => text
        .setValue(current.cliPathsByHost[getHostnameKey()] ?? current.cliPath)
        .setPlaceholder(localeText('留空以使用 dsh', 'Leave empty to use dsh'))
        .onChange(async value => {
          await context.plugin.mutateSettings(bag => {
            const paths = { ...getDshProviderSettings(bag).cliPathsByHost };
            if (value.trim()) paths[getHostnameKey()] = value.trim();
            else delete paths[getHostnameKey()];
            updateDshProviderSettings(bag, { cliPath: '', cliPathsByHost: paths, models: [] });
          });
          ProviderWorkspaceRegistry.getCliResolver('dsh')?.reset();
          await context.plugin.recycleProviderRuntimes?.('dsh');
          context.refreshModelSelectors();
        }));

    new Setting(container)
      .setName(localeText('启动超时（毫秒）', 'Startup timeout (ms)'))
      .setDesc(localeText('原生服务的启动等待时间，范围为 1000 至 600000 毫秒。', 'Time allowed for the native host to start, between 1000 and 600000 milliseconds.'))
      .addText(text => text.setValue(String(current.startupTimeoutMs)).onChange(async value => {
        const timeout = Number(value);
        if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 600000 || !Number.isInteger(timeout)) return;
        await context.plugin.mutateSettings(bag => { updateDshProviderSettings(bag, { startupTimeoutMs: timeout }); });
      }));

    new Setting(container)
      .setName(localeText('原生模型目录', 'Native model catalog'))
      .setDesc(localeText(
        '从原生服务刷新模型。此插件启动 CLI 的 web profile（dsh --profile web），其提供商和凭证需在该原生配置中单独设置，与桌面应用的配置相互独立。',
        'Refresh models from the native host. This plugin boots the CLI web profile (`dsh --profile web`); its providers and credentials are configured there and are separate from the Desktop app profile.',
      ))
      .addButton(button => {
        refreshButton = button;
        button.setButtonText(localeText('刷新模型', 'Refresh models')).setDisabled(!current.enabled).onClick(async () => {
          if (!getDshProviderSettings(settings).enabled) return;
          button.setDisabled(true);
          try {
            await ProviderWorkspaceRegistry.ensureInitialized(context.plugin, 'dsh', 'model-catalog-refresh');
            const result = await ProviderWorkspaceRegistry.refreshModelCatalog('dsh');
            context.refreshModelSelectors();
            context.refreshTitleGenerationModelOptions();
            new Notice(result.diagnostics ?? localeText('已刷新 DeepSeek Harness 模型目录。', 'DeepSeek Harness model catalog refreshed.'));
          } catch {
            new Notice(localeText('无法刷新模型目录，请检查 DeepSeek Harness 原生 CLI 配置。', 'Could not refresh the DeepSeek Harness model catalog. Check the native CLI configuration.'));
          } finally {
            button.setDisabled(!getDshProviderSettings(settings).enabled);
          }
        });
      });

    renderEnvironmentSettingsSection({
      container, plugin: context.plugin, scope: 'provider:dsh',
      name: localeText('DeepSeek Harness 环境变量', 'DeepSeek Harness environment variables'),
      desc: localeText('传递给 DeepSeek Harness 的环境变量。原生配置和凭证由 CLI 管理。', 'Environment variables passed to DeepSeek Harness. Native profiles and credentials remain managed by the CLI.'),
      placeholder: 'DSH_HOME=/path/to/deepseek-harness',
    });
  },
};
