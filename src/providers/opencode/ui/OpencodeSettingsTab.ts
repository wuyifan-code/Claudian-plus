import * as fs from 'fs';
import { Setting } from 'obsidian';

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
import { maybeGetOpencodeWorkspaceServices } from '../app/OpencodeWorkspaceServices';
import { clearOpencodeDiscoveryState } from '../discoveryState';
import { sameStringList } from '../internal/compareCollections';
import {
  buildOpencodeBaseModels,
  encodeOpencodeModelId,
  type OpencodeDiscoveredModel,
  splitOpencodeModelLabel,
} from '../models';
import { OpencodeChatRuntime } from '../runtime/OpencodeChatRuntime';
import {
  getOpencodeProviderSettings,
  normalizeOpencodeVisibleModels,
  OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES,
  updateOpencodeProviderSettings,
} from '../settings';
import { OpencodeAgentSettings } from './OpencodeAgentSettings';

const OPENCODE_METADATA_WARMUP_DB = ':memory:';

export const opencodeSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const opencodeWorkspace = maybeGetOpencodeWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const opencodeSettings = getOpencodeProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    new Setting(container).setName(localeText('设置', 'Setup')).setHeading();

    new Setting(container)
      .setName(localeText('启用 OpenCode', 'Enable OpenCode'))
      .setDesc(localeText('以提供商模式启动 `opencode acp`。', 'Launch `opencode acp` as a provider.'))
      .addToggle((toggle) =>
        toggle
          .setValue(opencodeSettings.enabled)
          .onChange(async (value) => {
            await applyProviderEnablementToggle(context, toggle, 'opencode', value);
          })
      );

    const cliPathSetting = new Setting(container)
      .setName(localeText('CLI 路径', 'CLI path'))
      .setDesc(localeText(
        '此电脑上 OpenCode CLI 的可选绝对路径。留空则使用 PATH 中的 `opencode`。',
        'Optional absolute path to the OpenCode CLI for this computer. Leave empty to use `opencode` from PATH.',
      ));

    const validationEl = container.createDiv({
      cls: 'claudian-plus-cli-path-validation claudian-plus-setting-validation claudian-plus-setting-validation-error claudian-plus-hidden',
    });
    const cliPathsByHost = { ...opencodeSettings.cliPathsByHost };
    const currentValue = opencodeSettings.cliPathsByHost[hostnameKey] || '';
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

    const recycleOpencodeRuntime = async (): Promise<void> => {
      await context.plugin.recycleProviderRuntimes?.('opencode');
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
        updateOpencodeProviderSettings(settings, { cliPathsByHost: { ...cliPathsByHost } });
        clearOpencodeDiscoveryState(settings);
      });
      opencodeWorkspace?.cliResolver?.reset();
      await recycleOpencodeRuntime();
      return true;
    };

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(process.platform === 'win32'
          ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\opencode.cmd'
          : '/usr/local/bin/opencode')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('claudian-plus-settings-cli-path-input');
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container).setName(localeText('模型', 'Models')).setHeading();
    renderOpencodeModelPicker(container, context, settingsBag);

    new Setting(container).setName(localeText('命令与技能', 'Commands and skills')).setHeading();

    const commandsDesc = container.createDiv({ cls: 'claudian-plus-sp-settings-desc' });
    commandsDesc.createEl('p', {
      cls: 'setting-item-description',
      text: localeText(
        'OpenCode 会自动发现 Vault 级别的 Claude 斜杠命令（.claude/commands/）以及来自 .claude/skills/、.codex/skills/ 和 .agents/skills/ 的技能。请在 Claude 或 Codex 设置页管理这些条目；此处只控制它们是否显示在 OpenCode 下拉菜单中。',
        'OpenCode can auto-detect vault-level Claude slash commands from .claude/commands/ and skills from .claude/skills/, .codex/skills/, and .agents/skills/. Manage those entries in the Claude or Codex settings tab. This setting only hides entries from the OpenCode dropdown.',
      ),
    });

    context.renderHiddenProviderCommandSetting(container, 'opencode', {
      name: localeText('隐藏命令与技能', 'Hidden Commands and Skills'),
      desc: localeText('从下拉菜单中隐藏指定的 OpenCode 命令和技能。每行填写一个名称，不要包含开头的斜杠。', 'Hide specific OpenCode commands and skills from the dropdown. Enter names without the leading slash, one per line.'),
      placeholder: 'compact\nreview\nfix',
    });

    if (opencodeWorkspace?.agentStorage) {
      new Setting(container).setName(localeText('子代理', 'Subagents')).setHeading();

      const subagentsDesc = container.createDiv({ cls: 'claudian-plus-sp-settings-desc' });
      subagentsDesc.createEl('p', {
        cls: 'setting-item-description',
        text: localeText(
          '管理来自 .opencode/agent/ 和旧版 .opencode/agents/ 的 Vault 级 OpenCode 子代理。新建条目会保存为仅供子代理使用的文件，并显示在 @ 提及菜单中。',
          'Manage vault-level OpenCode subagents from .opencode/agent/ and legacy .opencode/agents/. New entries are saved as subagent-only files and appear in the @mention menu.',
        ),
      });

      const subagentsContainer = container.createDiv({ cls: 'claudian-plus-slash-commands-container' });
      new OpencodeAgentSettings(
        subagentsContainer,
        opencodeWorkspace.agentStorage,
        context.plugin.app,
        async () => {
          await opencodeWorkspace.refreshAgentMentions?.();
          await recycleOpencodeRuntime();
        },
      );
    }

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:opencode',
      heading: localeText('环境', 'Environment'),
      name: localeText('环境变量', 'Environment Variables'),
      desc: localeText('额外传递给 OpenCode 的环境变量。默认启用 `OPENCODE_ENABLE_EXA=1`。', 'Extra environment variables passed to OpenCode. `OPENCODE_ENABLE_EXA=1` is enabled by default.'),
      placeholder: `${OPENCODE_DEFAULT_ENVIRONMENT_VARIABLES}\nOPENCODE_DB=/path/to/opencode.db`,
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'opencode'),
    });
  },
};

function renderOpencodeModelPicker(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
  settingsBag: Record<string, unknown>,
): void {
  const getState = (): ProviderModelPickerState => {
    const current = getOpencodeProviderSettings(settingsBag);
    return {
      aliases: current.modelAliases,
      discoveredCount: current.discoveredModels.length,
      models: buildOpencodePickerModels(current.discoveredModels, current.visibleModels),
      selectedIds: current.visibleModels,
    };
  };

  const warmModelMetadata = async (rawId: string): Promise<void> => {
    const runtime = new OpencodeChatRuntime(context.plugin);
    try {
      runtime.syncConversationState({
        providerState: { databasePath: OPENCODE_METADATA_WARMUP_DB },
        sessionId: null,
      });
      if (await runtime.warmModelMetadata(encodeOpencodeModelId(rawId))) {
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
    emptyCatalogText: localeText('请先启动一次 OpenCode 以加载模型目录，之后即可选择要在聊天模型选择器中显示的模型。', 'Start OpenCode once to load its model catalog. Claudian Plus will then let you pick visible models.'),
    failedCatalogText: localeText('无法加载 OpenCode 模型目录。请检查 CLI 路径和登录状态后重试。', 'Could not load the OpenCode model catalog. Check the CLI path and login state, then try again.'),
    getState,
    async loadCatalog() {
      const runtime = new OpencodeChatRuntime(context.plugin);
      try {
        runtime.syncConversationState({
          providerState: { databasePath: OPENCODE_METADATA_WARMUP_DB },
          sessionId: null,
        });
        const loaded = await runtime.ensureReady({ allowSessionCreation: true });
        const discoveredCount = getOpencodeProviderSettings(settingsBag).discoveredModels.length;
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
    loadingCatalogText: localeText('正在加载 OpenCode 模型目录…', 'Loading OpenCode model catalog...'),
    modifier: 'opencode',
    async onAliasesChange(modelAliases) {
      await context.plugin.mutateSettings((settings) => {
        updateOpencodeProviderSettings(settings, { modelAliases });
      });
      context.refreshModelSelectors();
    },
    onModelSelected: async (model) => warmModelMetadata(model.id),
    async onSelectedIdsChange(visibleModels) {
      const current = getOpencodeProviderSettings(settingsBag);
      const normalized = normalizeOpencodeVisibleModels(visibleModels, current.discoveredModels);
      if (sameStringList(current.visibleModels, normalized)) {
        return;
      }

      await context.plugin.mutateSettings((settings) => {
        updateOpencodeProviderSettings(settings, { visibleModels: normalized });
      });
      context.refreshModelSelectors();
    },
    providerName: 'OpenCode',
    settingDescription: localeText('选择在聊天模型选择器中显示的 OpenCode 模型。可以按提供商或类型筛选。当前会话模型即使未在此选择，也会保持固定。', 'Choose which OpenCode models appear in the chat selector. Filter by provider or type to search. The current session model stays pinned even if it is not selected here.'),
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

function buildOpencodePickerModels(
  discoveredModels: OpencodeDiscoveredModel[],
  visibleModels: string[],
): ProviderModelPickerModel[] {
  const models: ProviderModelPickerModel[] = [];
  const discoveredIds = new Set<string>();

  for (const model of buildOpencodeBaseModels(discoveredModels)) {
    const { modelLabel, providerLabel } = splitOpencodeModelLabel(model.label || model.rawId);
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

    const { modelLabel, providerLabel } = splitOpencodeModelLabel(rawId);
    models.push({
      id: rawId,
      isAvailable: false,
      name: modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      unavailableMessage: localeText('OpenCode 当前未报告此模型', 'Not currently reported by OpenCode'),
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
