import * as fs from 'fs';
import { Setting } from 'obsidian';

import { sameStringList } from '../../../core/providers/compareCollections';
import type {
  ProviderSettingsTabRenderer,
  ProviderSettingsTabRendererContext,
} from '../../../core/providers/types';
import { localeText } from '../../../i18n/i18n';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { applyProviderEnablementToggle } from '../../../shared/settings/ProviderEnablementToggle';
import {
  type ProviderModelPickerState,
  renderProviderModelPicker,
} from '../../../shared/settings/ProviderModelPicker';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { DshModelDiscoveryService } from '../app/DshModelDiscoveryService';
import { ensureDshProfile } from '../app/DshProfileProvisioner';
import { maybeGetDshWorkspaceServices } from '../app/DshWorkspaceServices';
import {
  buildDshPickerModels,
  normalizeDshVisibleModels,
} from '../models';
import {
  getDshProviderSettings,
  updateDshProviderSettings,
} from '../settings';
import { renderDshDiscoverySections } from './DshDiscoverySections';

export const dshSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const dshWorkspace = maybeGetDshWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const dshSettings = getDshProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    new Setting(container).setName(localeText('设置', 'Setup')).setHeading();

    new Setting(container)
      .setName(localeText('启用 DeepSeek', 'Enable DeepSeek'))
      .setDesc(localeText(
        '以提供商模式启动 DeepSeek Harness 的 ACP server（`dsh --profile <名称>`）。',
        'Launch the DeepSeek Harness ACP server (`dsh --profile <name>`) as a provider.',
      ))
      .addToggle((toggle) =>
        toggle
          .setValue(dshSettings.enabled)
          .onChange(async (value) => {
            await applyProviderEnablementToggle(context, toggle, 'dsh', value);
          })
      );

    const cliPathSetting = new Setting(container)
      .setName(localeText('CLI 路径', 'CLI path'))
      .setDesc(localeText(
        '此电脑上 `dsh` 命令的可选绝对路径。留空则使用 PATH 中的 `dsh`。',
        'Optional absolute path to the `dsh` CLI for this computer. Leave empty to use `dsh` from PATH.',
      ));

    const validationEl = container.createDiv({
      cls: 'claudian-plus-cli-path-validation claudian-plus-setting-validation claudian-plus-setting-validation-error claudian-plus-hidden',
    });
    const cliPathsByHost = { ...dshSettings.cliPathsByHost };
    const currentValue = dshSettings.cliPathsByHost[hostnameKey] || '';
    let cliPathInputEl: HTMLInputElement | null = null;

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validateCliPath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('claudian-plus-hidden', false);
        inputEl?.toggleClass('claudian-plus-input-error', true);
        return false;
      }

      validationEl.toggleClass('claudian-plus-hidden', true);
      inputEl?.toggleClass('claudian-plus-input-error', false);
      return true;
    };

    const recycleDshRuntime = async (): Promise<void> => {
      await context.plugin.recycleProviderRuntimes?.('dsh');
    };

    const persistCliPath = async (value: string): Promise<boolean> => {
      if (!updateCliPathValidation(value, cliPathInputEl ?? undefined)) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      await context.plugin.mutateSettings((settings) => {
        updateDshProviderSettings(settings, { cliPathsByHost: { ...cliPathsByHost } });
      });
      dshWorkspace?.cliResolver?.reset();
      await recycleDshRuntime();
      return true;
    };

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(process.platform === 'win32'
          ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\dsh.cmd'
          : '/usr/local/bin/dsh')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('claudian-plus-settings-cli-path-input');
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container)
      .setName(localeText('Profile', 'Profile'))
      .setDesc(localeText(
        '要启动的 DSH profile 名称（`$DSH_HOME/profiles/<名称>`）。profile 缺失时会在首次启动时自动创建并安装 acp-agent 组合。',
        'Name of the DSH profile to boot (`$DSH_HOME/profiles/<name>`). A missing profile is auto-created with the acp-agent composition on first launch.',
      ))
      .addText((text) =>
        text
          .setPlaceholder('Acp')
          .setValue(dshSettings.profile)
          .onChange(async (value) => {
            const trimmed = value.trim();
            await context.plugin.mutateSettings((settings) => {
              updateDshProviderSettings(settings, { profile: trimmed });
            });
            await recycleDshRuntime();
            refreshProfileStatus();
          })
      );

    const profileStatusSetting = new Setting(container)
      .setName(localeText('Profile 状态', 'Profile status'))
      .setDesc(localeText('检查中…', 'Checking...'));

    const refreshProfileStatus = async (): Promise<void> => {
      const current = getDshProviderSettings(settingsBag);
      const provision = await ensureDshProfile(
        current.profile,
        current.providerRoute,
      );
      if (provision.status === 'error') {
        profileStatusSetting.setDesc(provision.error);
        return;
      }
      const statusText = provision.status === 'provisioned'
        ? localeText(
          `已创建 profile（${provision.profileDir}）`,
          `Profile created (${provision.profileDir})`,
        )
        : localeText(
          `Profile 已就绪（${provision.profileDir}）`,
          `Profile ready (${provision.profileDir})`,
        );
      profileStatusSetting.setDesc(statusText);
    };

    profileStatusSetting.addButton((button) =>
      button
        .setButtonText(localeText('创建/修复', 'Create/Repair'))
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText(localeText('处理中…', 'Working...'));
          try {
            await refreshProfileStatus();
          } finally {
            button.setDisabled(false);
            button.setButtonText(localeText('创建/修复', 'Create/Repair'));
          }
        })
    );

    void refreshProfileStatus();

    new Setting(container)
      .setName(localeText('Provider 路由', 'Provider route'))
      .setDesc(localeText(
        'DSH 模型适配器路由（对应 profile 中 llm 适配器的 provider 路由，如 deepseek-official）。',
        'DSH model-adapter route (matches the llm adapter provider route in the profile, e.g. deepseek-official).',
      ))
      .addText((text) =>
        text
          .setPlaceholder('Deepseek-official')
          .setValue(dshSettings.providerRoute)
          .onChange(async (value) => {
            const trimmed = value.trim();
            await context.plugin.mutateSettings((settings) => {
              updateDshProviderSettings(settings, { providerRoute: trimmed });
            });
            await recycleDshRuntime();
          })
      );

    new Setting(container).setName(localeText('模型', 'Models')).setHeading();
    renderDshModelPicker(container, context, settingsBag);

    void renderDshDiscoverySections(container, context);

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:dsh',
      heading: localeText('环境', 'Environment'),
      name: localeText('环境变量', 'Environment Variables'),
      desc: localeText(
        '额外传递给 dsh 进程的环境变量（如 DEEPSEEK_API_KEY）。',
        'Extra environment variables passed to the dsh process (e.g. DEEPSEEK_API_KEY).',
      ),
      placeholder: 'DEEPSEEK_API_KEY=sk-...',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'dsh'),
    });
  },
};

function renderDshModelPicker(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
  settingsBag: Record<string, unknown>,
): void {
  const getState = (): ProviderModelPickerState => {
    const current = getDshProviderSettings(settingsBag);
    return {
      aliases: current.modelAliases,
      discoveredCount: current.discoveredModels.length,
      models: buildDshPickerModels(current.discoveredModels, current.visibleModels),
      selectedIds: current.visibleModels,
    };
  };

  renderProviderModelPicker({
    container,
    emptyCatalogText: localeText(
      '未在 DSH profile 中发现模型。请确认 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 中的 llm 适配器配置了 models 列表。',
      'No models found in the DSH profile. Make sure the llm adapter in `$DSH_HOME/profiles/<profile>/cordis.patch.yml` registers a models list.',
    ),
    failedCatalogText: localeText('无法读取 DSH profile。', 'Could not read the DSH profile.'),
    getState,
    async loadCatalog() {
      const discovery = new DshModelDiscoveryService(context.plugin);
      const result = await discovery.refreshModelCatalog();
      if (result.changed) {
        context.refreshModelSelectors();
      }
      const discoveredCount = getDshProviderSettings(settingsBag).discoveredModels.length;
      return discoveredCount > 0 ? 'loaded' : 'empty';
    },
    loadCatalogOnRender: true,
    loadingCatalogText: localeText('正在读取 DSH profile…', 'Reading DSH profile...'),
    modifier: 'dsh',
    async onAliasesChange(modelAliases) {
      await context.plugin.mutateSettings((settings) => {
        updateDshProviderSettings(settings, { modelAliases });
      });
      context.refreshModelSelectors();
    },
    async onSelectedIdsChange(visibleModels) {
      const current = getDshProviderSettings(settingsBag);
      const normalized = normalizeDshVisibleModels(visibleModels);
      if (sameStringList(current.visibleModels, normalized)) {
        return;
      }

      await context.plugin.mutateSettings((settings) => {
        updateDshProviderSettings(settings, { visibleModels: normalized });
      });
      context.refreshModelSelectors();
    },
    providerName: 'DeepSeek',
    settingDescription: localeText(
      '选择出现在聊天模型选择器中的 DeepSeek 模型。目录从 DSH profile 的 llm 适配器自动读取。',
      'Choose which DeepSeek models appear in the chat selector. The catalog is read from the llm adapter in the DSH profile.',
    ),
  });
}

function validateCliPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const expandedPath = expandHomePath(trimmed);
  if (!fs.existsSync(expandedPath)) {
    return localeText('路径不存在', 'Path does not exist');
  }
  if (!fs.statSync(expandedPath).isFile()) {
    return localeText('路径必须指向文件', 'Path must point to a file');
  }
  return null;
}
