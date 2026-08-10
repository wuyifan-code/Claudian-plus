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
  type ProviderModelPickerModel,
  type ProviderModelPickerState,
  renderProviderModelPicker,
} from '../../../shared/settings/ProviderModelPicker';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetKimiWorkspaceServices } from '../app/KimiWorkspaceServices';
import { clearKimiDiscoveryState } from '../discoveryState';
import {
  buildKimiBaseModels,
  encodeKimiModelId,
  type KimiDiscoveredModel,
  normalizeKimiVisibleModels,
  splitKimiModelLabel,
} from '../models';
import { KimiChatRuntime } from '../runtime/KimiChatRuntime';
import {
  getKimiProviderSettings,
  updateKimiProviderSettings,
} from '../settings';

export const kimiSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const kimiWorkspace = maybeGetKimiWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const kimiSettings = getKimiProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    new Setting(container).setName(localeText('设置', 'Setup')).setHeading();

    new Setting(container)
      .setName(localeText('启用 Kimi', 'Enable Kimi'))
      .setDesc(localeText('以提供商模式启动 `kimi acp`。', 'Launch `kimi acp` as a provider.'))
      .addToggle((toggle) =>
        toggle
          .setValue(kimiSettings.enabled)
          .onChange(async (value) => {
            await applyProviderEnablementToggle(context, toggle, 'kimi', value);
          })
      );

    const cliPathSetting = new Setting(container)
      .setName(localeText('CLI 路径', 'CLI path'))
      .setDesc(localeText(
        '此电脑上 Kimi Code CLI 的可选绝对路径。留空则使用 PATH 中的 `kimi`。',
        'Optional absolute path to the Kimi Code CLI for this computer. Leave empty to use `kimi` from PATH.',
      ));

    const validationEl = container.createDiv({
      cls: 'claudian-plus-cli-path-validation claudian-plus-setting-validation claudian-plus-setting-validation-error claudian-plus-hidden',
    });
    const cliPathsByHost = { ...kimiSettings.cliPathsByHost };
    const currentValue = kimiSettings.cliPathsByHost[hostnameKey] || '';
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

    const recycleKimiRuntime = async (): Promise<void> => {
      await context.plugin.recycleProviderRuntimes?.('kimi');
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
        updateKimiProviderSettings(settings, { cliPathsByHost: { ...cliPathsByHost } });
        clearKimiDiscoveryState(settings);
      });
      kimiWorkspace?.cliResolver?.reset();
      await recycleKimiRuntime();
      return true;
    };

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(process.platform === 'win32'
          ? 'C:\\Users\\you\\.local\\bin\\kimi.exe'
          : '/usr/local/bin/kimi')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('claudian-plus-settings-cli-path-input');
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container).setName(localeText('模型', 'Models')).setHeading();
    renderKimiModelPicker(container, context, settingsBag);

    new Setting(container).setName(localeText('命令', 'Commands')).setHeading();

    const commandsDesc = container.createDiv({ cls: 'claudian-plus-sp-settings-desc' });
    commandsDesc.createEl('p', {
      cls: 'setting-item-description',
      text: localeText(
        'Kimi 的斜杠命令（如 /compact、/clear）由 Kimi Code CLI 在会话中自动发现，此处只能控制它们是否显示在下拉菜单中。',
        'Kimi slash commands (e.g. /compact, /clear) are discovered from the running Kimi Code CLI session. This setting only hides entries from the dropdown.',
      ),
    });

    context.renderHiddenProviderCommandSetting(container, 'kimi', {
      name: localeText('隐藏命令', 'Hidden Commands'),
      desc: localeText('从下拉菜单中隐藏指定的 Kimi 命令。每行填写一个名称，不要包含开头的斜杠。', 'Hide specific Kimi commands from the dropdown. Enter names without the leading slash, one per line.'),
      placeholder: 'compact\nclear',
    });

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:kimi',
      heading: localeText('环境', 'Environment'),
      name: localeText('环境变量', 'Environment Variables'),
      desc: localeText('额外传递给 Kimi Code CLI 的环境变量。', 'Extra environment variables passed to Kimi Code CLI.'),
      placeholder: 'KIMI_HOME=C:\\Users\\you\\.kimi',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'kimi'),
    });
  },
};

function renderKimiModelPicker(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
  settingsBag: Record<string, unknown>,
): void {
  const getState = (): ProviderModelPickerState => {
    const current = getKimiProviderSettings(settingsBag);
    return {
      aliases: current.modelAliases,
      discoveredCount: current.discoveredModels.length,
      models: buildKimiPickerModels(current.discoveredModels, current.visibleModels),
      selectedIds: current.visibleModels,
    };
  };

  const warmModelMetadata = async (rawId: string): Promise<void> => {
    const runtime = new KimiChatRuntime(context.plugin);
    try {
      runtime.syncConversationState({ sessionId: null });
      if (await runtime.warmModelMetadata(encodeKimiModelId(rawId))) {
        context.refreshModelSelectors();
      }
    } catch {
      // Metadata warmup is opportunistic; the first chat turn can still discover it.
    } finally {
      runtime.cleanup();
    }
  };

  renderProviderModelPicker({
    container,
    emptyCatalogText: localeText('请先启动一次 Kimi Code CLI 以加载模型目录，之后即可选择要在聊天模型选择器中显示的模型。', 'Start Kimi Code CLI once to load its model catalog. Claudian Plus will then let you pick visible models.'),
    failedCatalogText: localeText('无法加载 Kimi 模型目录。请检查 CLI 路径和登录状态后重试。', 'Could not load the Kimi model catalog. Check the CLI path and login state, then try again.'),
    getState,
    async loadCatalog() {
      const runtime = new KimiChatRuntime(context.plugin);
      try {
        runtime.syncConversationState({ sessionId: null });
        const loaded = await runtime.ensureReady({ allowSessionCreation: true });
        const discoveredCount = getKimiProviderSettings(settingsBag).discoveredModels.length;
        if (!loaded) {
          return 'failed';
        }
        if (discoveredCount > 0) {
          context.refreshModelSelectors();
          return 'loaded';
        }
        return 'empty';
      } catch {
        return 'failed';
      } finally {
        runtime.cleanup();
      }
    },
    loadCatalogOnRender: true,
    loadingCatalogText: localeText('正在加载 Kimi 模型目录…', 'Loading Kimi model catalog...'),
    modifier: 'kimi',
    async onAliasesChange(modelAliases) {
      await context.plugin.mutateSettings((settings) => {
        updateKimiProviderSettings(settings, { modelAliases });
      });
      context.refreshModelSelectors();
    },
    onModelSelected: async (model) => warmModelMetadata(model.id),
    async onSelectedIdsChange(visibleModels) {
      const current = getKimiProviderSettings(settingsBag);
      const normalized = normalizeKimiVisibleModels(visibleModels, current.discoveredModels);
      if (sameStringList(current.visibleModels, normalized)) {
        return;
      }

      await context.plugin.mutateSettings((settings) => {
        updateKimiProviderSettings(settings, { visibleModels: normalized });
      });
      context.refreshModelSelectors();
    },
    providerName: 'Kimi',
    settingDescription: localeText('选择在聊天模型选择器中显示的 Kimi 模型。当前会话模型即使未在此选择，也会保持固定。', 'Choose which Kimi models appear in the chat selector. The current session model stays pinned even if it is not selected here.'),
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

function buildKimiPickerModels(
  discoveredModels: KimiDiscoveredModel[],
  visibleModels: string[],
): ProviderModelPickerModel[] {
  const models: ProviderModelPickerModel[] = [];
  const discoveredIds = new Set<string>();

  for (const model of buildKimiBaseModels(discoveredModels)) {
    const { modelLabel, providerLabel } = splitKimiModelLabel(model.label || model.rawId);
    discoveredIds.add(model.rawId);
    models.push({
      description: model.description ?? '',
      id: model.rawId,
      isAvailable: true,
      name: modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
    });
  }

  for (const rawId of visibleModels) {
    if (discoveredIds.has(rawId)) {
      continue;
    }

    const { modelLabel, providerLabel } = splitKimiModelLabel(rawId);
    models.push({
      id: rawId,
      isAvailable: false,
      name: modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      unavailableMessage: localeText('Kimi 当前未报告此模型', 'Not currently reported by Kimi Code CLI'),
    });
  }

  return models.sort((left, right) => {
    const providerCmp = (left.providerLabel ?? '').localeCompare(right.providerLabel ?? '');
    if (providerCmp !== 0) {
      return providerCmp;
    }
    return left.name.localeCompare(right.name);
  });
}
