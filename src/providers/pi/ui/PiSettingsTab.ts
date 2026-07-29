import * as fs from 'node:fs';

import { Notice, Setting } from 'obsidian';

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
import { maybeGetPiWorkspaceServices } from '../app/PiWorkspaceServices';
import { sameStringList } from '../internal/compareCollections';
import { decodePiModelId, type PiDiscoveredModel } from '../models';
import { PiModelDiscoveryService } from '../runtime/PiModelDiscoveryService';
import {
  getPiProviderSettings,
  normalizePiVisibleModels,
  updatePiProviderSettings,
} from '../settings';

export const piSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const piSettings = getPiProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const workspace = maybeGetPiWorkspaceServices();

    new Setting(container).setName(localeText('设置', 'Setup')).setHeading();

    new Setting(container)
      .setName(localeText('启用 Pi', 'Enable Pi'))
      .setDesc(localeText('以提供商模式启动 `pi --mode rpc`。', 'Launch `pi --mode rpc` as a provider.'))
      .addToggle((toggle) =>
        toggle
          .setValue(piSettings.enabled)
          .onChange(async (value) => {
            await applyProviderEnablementToggle(context, toggle, 'pi', value);
          })
      );

    const validationEl = container.createDiv({
      cls: 'claudian-plus-cli-path-validation claudian-plus-setting-validation claudian-plus-setting-validation-error claudian-plus-hidden',
    });
    const cliPathsByHost = { ...piSettings.cliPathsByHost };
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

    const persistCliPath = async (value: string): Promise<void> => {
      if (!updateCliPathValidation(value, cliPathInputEl ?? undefined)) {
        return;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      await context.plugin.mutateSettings((settings) => {
        updatePiProviderSettings(settings, {
          cliPathsByHost: { ...cliPathsByHost },
          discoveredModels: [],
        });
        workspace?.cliResolver?.reset();
      });
      context.refreshModelSelectors();
    };

    new Setting(container)
      .setName(localeText('CLI 路径', 'CLI path'))
      .setDesc(localeText(
        '此电脑上 Pi CLI 的可选绝对路径。留空则使用 PATH 中的 `pi`。',
        'Optional absolute path to the Pi CLI for this computer. Leave empty to use `pi` from PATH.',
      ))
      .addText((text) => {
        const currentValue = piSettings.cliPathsByHost[hostnameKey] || '';
        text
          .setPlaceholder(process.platform === 'win32'
            ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\pi.cmd'
            : '/usr/local/bin/pi')
          .setValue(currentValue)
          .onChange((value) => {
            void persistCliPath(value);
          });
        cliPathInputEl = text.inputEl;
        updateCliPathValidation(currentValue, text.inputEl);
      });

    new Setting(container).setName(localeText('模型', 'Models')).setHeading();
    renderPiModelPicker(container, context, settingsBag);

    renderEnvironmentSettingsSection({
      container,
      desc: localeText('仅传递给 Pi 的环境变量。', 'Environment variables passed only to Pi.'),
      heading: localeText('环境', 'Environment'),
      name: localeText('Pi 环境变量', 'Pi environment variables'),
      placeholder: 'PI_CODING_AGENT_SESSION_DIR=/path/to/sessions',
      plugin: context.plugin,
      scope: 'provider:pi',
    });
  },
};

function renderPiModelPicker(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
  settingsBag: Record<string, unknown>,
): void {
  const getState = (): ProviderModelPickerState => {
    const current = getPiProviderSettings(settingsBag);
    return {
      aliases: current.modelAliases,
      discoveredCount: current.discoveredModels.length,
      models: buildPiPickerModels(current.discoveredModels, current.visibleModels),
      selectedIds: current.visibleModels,
    };
  };

  renderProviderModelPicker({
    container,
    emptyCatalogText: localeText('尚未发现 Pi 模型。点击“发现模型”从 Pi 加载模型。', 'No Pi models discovered yet. Click Discover to load models from Pi.'),
    failedCatalogText: localeText('无法加载 Pi 模型目录。请检查 CLI 路径和登录状态后重试。', 'Could not load the Pi model catalog. Check the CLI path and login state, then try again.'),
    getState,
    async loadCatalog() {
      const result = await new PiModelDiscoveryService(context.plugin).discoverModels();
      if (result.kind === 'skipped') {
        return getPiProviderSettings(settingsBag).discoveredModels.length > 0 ? 'loaded' : 'empty';
      }
      if (result.diagnostics) {
        new Notice(`Pi discovery failed: ${result.diagnostics}`);
        return 'failed';
      }

      const current = getPiProviderSettings(settingsBag);
      const normalizedVisibleModels = normalizePiVisibleModels(current.visibleModels, result.models);
      const shouldPersist = result.models.length > 0
        || current.discoveredModels.length > 0
        || !sameStringList(current.visibleModels, normalizedVisibleModels);
      if (shouldPersist) {
        await context.plugin.mutateSettings((settings) => {
          updatePiProviderSettings(settings, {
            discoveredModels: result.models,
            visibleModels: normalizedVisibleModels,
          });
        });
        context.refreshModelSelectors();
      }
      return result.models.length > 0 ? 'loaded' : 'empty';
    },
    loadingCatalogText: localeText('正在加载 Pi 模型目录…', 'Loading Pi model catalog...'),
    modifier: 'pi',
    async onAliasesChange(modelAliases) {
      await context.plugin.mutateSettings((settings) => {
        updatePiProviderSettings(settings, { modelAliases });
      });
      context.refreshModelSelectors();
    },
    async onSelectedIdsChange(visibleModels) {
      const current = getPiProviderSettings(settingsBag);
      const normalized = normalizePiVisibleModels(visibleModels, current.discoveredModels);
      if (sameStringList(current.visibleModels, normalized)) {
        return;
      }

      await context.plugin.mutateSettings((settings) => {
        updatePiProviderSettings(settings, { visibleModels: normalized });
      });
      context.refreshModelSelectors();
    },
    providerName: 'Pi',
    settingDescription: localeText(
      '选择在聊天模型选择器中显示的 Pi 模型。可以按提供商或类型筛选。当前会话模型即使未在此选择，也会保持固定。',
      'Choose which Pi models appear in the chat selector. Filter by provider or type to search. The current session model stays pinned even if it is not selected here.',
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

function buildPiPickerModels(
  discoveredModels: PiDiscoveredModel[],
  visibleModels: string[],
): ProviderModelPickerModel[] {
  const models: ProviderModelPickerModel[] = [];
  const discoveredIds = new Set<string>();

  for (const model of discoveredModels) {
    discoveredIds.add(model.encodedId);
    models.push({
      description: buildPiModelDescription(model),
      id: model.encodedId,
      isAvailable: true,
      name: model.label || model.id,
      providerKey: model.provider.toLowerCase(),
      providerLabel: formatProviderLabel(model.provider),
    });
  }

  for (const encodedId of visibleModels) {
    if (discoveredIds.has(encodedId)) {
      continue;
    }

    const decoded = decodePiModelId(encodedId);
    const provider = decoded?.provider ?? 'pi';
    models.push({
      description: 'Configured model',
      id: encodedId,
      isAvailable: false,
      name: decoded?.modelId ?? encodedId,
      providerKey: provider.toLowerCase(),
      providerLabel: formatProviderLabel(provider),
      unavailableMessage: 'Not currently reported by Pi',
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

function buildPiModelDescription(model: PiDiscoveredModel): string {
  const details: string[] = [];
  if (model.api) {
    details.push(`API: ${model.api}`);
  }
  if (model.contextWindow) {
    details.push(`${model.contextWindow.toLocaleString()} context`);
  }
  if (model.maxTokens) {
    details.push(`${model.maxTokens.toLocaleString()} output`);
  }
  if (model.input.includes('image')) {
    details.push('image input');
  }
  details.push(model.reasoning
    ? `thinking: ${model.thinkingLevels.join(', ')}`
    : 'thinking: off');

  return details.join(' | ');
}

function formatProviderLabel(provider: string): string {
  const normalized = provider.trim();
  const knownProviders: Record<string, string> = {
    anthropic: 'Anthropic',
    deepseek: 'DeepSeek',
    google: 'Google',
    openai: 'OpenAI',
    xai: 'xAI',
  };
  const known = knownProviders[normalized.toLowerCase()];
  if (known) {
    return known;
  }

  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Pi';
}
