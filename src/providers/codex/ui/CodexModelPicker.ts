import { Notice } from 'obsidian';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderSettingsTabRendererContext } from '../../../core/providers/types';
import { localeText } from '../../../i18n/i18n';
import {
  type ProviderModelPickerModel,
  type ProviderModelPickerState,
  renderProviderModelPicker,
} from '../../../shared/settings/ProviderModelPicker';
import type { CodexWorkspaceServices } from '../app/CodexWorkspaceServices';
import { getCodexModelsInPickerOrder } from '../models';
import {
  createCodexVisibleModelFilter,
  getCodexProviderSettings,
  getVisibleCodexModelIds,
  updateCodexProviderSettings,
} from '../settings';

function sameVisibleModels(left: string[] | null, right: string[] | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function renderCodexModelPicker(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
  workspace: CodexWorkspaceServices,
): void {
  const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;

  const getState = (): ProviderModelPickerState => {
    const current = getCodexProviderSettings(settingsBag);
    const pickerOrderedModels = getCodexModelsInPickerOrder(current.discoveredModels);
    const visibleModelIds = getVisibleCodexModelIds(
      current.visibleModels,
      current.discoveredModels,
    );
    const visibleModelIdSet = new Set(visibleModelIds);
    const selectedIds = pickerOrderedModels
      .map(model => model.model)
      .filter(modelId => visibleModelIdSet.has(modelId));
    for (const modelId of visibleModelIds) {
      if (!selectedIds.includes(modelId)) {
        selectedIds.push(modelId);
      }
    }

    const models: ProviderModelPickerModel[] = pickerOrderedModels.map(model => ({
      ...(model.isDefault ? { catalogBadge: localeText('默认', 'Default') } : {}),
      description: model.description,
      id: model.model,
      isAvailable: true,
      name: model.displayName,
    }));
    const discoveredIds = new Set(models.map(model => model.id));
    for (const modelId of visibleModelIds) {
      if (!discoveredIds.has(modelId)) {
        models.push({
          description: localeText('已选择的模型', 'Selected model'),
          id: modelId,
          isAvailable: false,
          name: modelId,
          unavailableMessage: localeText('Codex 当前未报告此模型', 'Not currently reported by Codex'),
        });
      }
    }

    return {
      aliases: current.modelAliases,
      discoveredCount: current.discoveredModels.length,
      models,
      selectedIds,
    };
  };

  const persistVisibleModels = async (modelIds: string[]): Promise<void> => {
    const current = getCodexProviderSettings(settingsBag);
    const nextVisibleModels = createCodexVisibleModelFilter(modelIds, current.discoveredModels);
    if (sameVisibleModels(current.visibleModels, nextVisibleModels)) {
      return;
    }

    await context.plugin.mutateSettings((settings) => {
      updateCodexProviderSettings(settings, { visibleModels: nextVisibleModels });
      ProviderSettingsCoordinator.normalizeAllModelVariants(settings);
    });
    context.refreshModelSelectors();
  };

  let refreshPicker = (): void => {};
  const picker = renderProviderModelPicker({
    checkCatalogFreshnessWhenCached: true,
    container,
    emptyCatalogText: localeText('尚未发现 Codex 模型。点击“发现模型”从 app-server 查询。', 'No Codex models discovered yet. Click Discover to query app-server.'),
    failedCatalogText: localeText('无法从 Codex app-server 加载模型。请检查 CLI 路径和登录状态后重试。', 'Could not load models from Codex app-server. Check the CLI path and login state, then try again.'),
    getState,
    initiallyOpen: getCodexProviderSettings(settingsBag).discoveredModels.length === 0,
    async loadCatalog(force) {
      if (!workspace.modelCatalogCoordinator) {
        return 'failed';
      }

      const result = await workspace.modelCatalogCoordinator.ensureFresh('model-picker', { force });
      if (result.backgroundRefresh) {
        void result.backgroundRefresh.then(
          () => {
            context.refreshModelSelectors();
            refreshPicker();
          },
          () => refreshPicker(),
        );
      }
      if (result.diagnostics) {
        new Notice(localeText(`Codex 模型发现失败：${result.diagnostics}`, `Codex model discovery failed: ${result.diagnostics}`));
        return 'failed';
      }
      context.refreshModelSelectors();
      return getCodexProviderSettings(settingsBag).discoveredModels.length > 0 ? 'loaded' : 'empty';
    },
    loadingCatalogText: localeText('正在加载 Codex 模型目录…', 'Loading the Codex model catalog...'),
    modifier: 'codex',
    async onAliasesChange(modelAliases) {
      await context.plugin.mutateSettings((settings) => {
        updateCodexProviderSettings(settings, { modelAliases });
      });
      context.refreshModelSelectors();
    },
    onSelectedIdsChange: persistVisibleModels,
    providerName: 'Codex',
    searchPlaceholder: localeText('按模型名称、描述或 ID 筛选…', 'Filter by model name, description, or ID...'),
    settingDescription: localeText('选择哪些 app-server 模型显示在 Codex 选择器中。即使在此隐藏，已有会话使用的模型仍会保持固定。', 'Choose which app-server models appear in the Codex selector. Existing session models stay pinned even when hidden here.'),
  });
  refreshPicker = picker.refresh.bind(picker);
}
