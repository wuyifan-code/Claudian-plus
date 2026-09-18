import * as fs from 'node:fs';

import { Notice, Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { localeText } from '../../../i18n/i18n';
import { applyProviderEnablementToggle } from '../../../shared/settings/ProviderEnablementToggle';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import {
  type AntigravityWorkspaceServices,
  maybeGetAntigravityWorkspaceServices,
} from '../app/AntigravityWorkspaceServices';
import { formatAntigravityDiagnosticsReport } from '../diagnostics/redactAntigravityDiagnostics';
import type { AntigravityLastFailure } from '../lastFailure';
import {
  ANTIGRAVITY_DEFAULT_TIMEOUT_MS,
  getAntigravityProviderSettings,
  requestAntigravityDiagnosticsRefresh,
  updateAntigravityProviderSettings,
} from '../settings';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '../types';

export const antigravitySettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const antigravitySettings = getAntigravityProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const workspace = maybeGetAntigravityWorkspaceServices();

    new Setting(container).setName(localeText('设置', 'Setup')).setHeading();

    new Setting(container)
      .setName(localeText('启用 Antigravity', 'Enable Antigravity'))
      .setDesc(localeText(
        '以提供商模式运行官方 `agy` CLI。默认关闭。CLI 的使用与消耗遵循你 Antigravity 账户自身的 `agy` 配置。',
        'Runs the official `agy` CLI as a provider. Disabled by default. CLI usage and consumption follow your Antigravity account\'s own `agy` configuration.',
      ))
      .addToggle((toggle) =>
        toggle
          .setValue(antigravitySettings.enabled)
          .onChange(async (value) => {
            await applyProviderEnablementToggle(context, toggle, 'antigravity', value);
          })
      );

    const validationEl = container.createDiv({
      cls: 'claudian-plus-cli-path-validation claudian-plus-setting-validation claudian-plus-setting-validation-error claudian-plus-hidden',
    });
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

      await context.plugin.mutateSettings((settings) => {
        updateAntigravityProviderSettings(settings, { cliPath: value.trim() });
      });
      workspace?.cliResolver?.reset();
      await context.plugin.recycleProviderRuntimes?.('antigravity');
      context.refreshModelSelectors();
    };

    new Setting(container)
      .setName(localeText('CLI 路径', 'CLI path'))
      .setDesc(localeText(
        '此电脑上 agy CLI 的可选绝对路径。留空则使用 PATH 中的 `agy`。',
        'Optional absolute path to the agy CLI for this computer. Leave empty to look up `agy` in PATH.',
      ))
      .addText((text) => {
        const currentValue = antigravitySettings.cliPathsByHost[hostnameKey] || '';
        text
          .setPlaceholder(process.platform === 'win32'
            ? 'C:\\Users\\you\\AppData\\Local\\agy\\bin\\agy.EXE'
            : '/usr/local/bin/agy')
          .setValue(currentValue)
          .onChange((value) => {
            void persistCliPath(value);
          });
        cliPathInputEl = text.inputEl;
        updateCliPathValidation(currentValue, text.inputEl);
      });

    new Setting(container).setName(localeText('模型', 'Models')).setHeading();

    const persistManualModelId = async (value: string): Promise<void> => {
      await context.plugin.mutateSettings((settings) => {
        updateAntigravityProviderSettings(settings, { manualModelId: value });
      });
      context.refreshModelSelectors();
    };

    new Setting(container)
      .setName(localeText('手动模型 ID', 'Manual model id'))
      .setDesc(localeText(
        '传给 `agy --model` 的模型 ID（例如 gemini-3.8-flash-low）。Antigravity 没有模型发现，需要手动填写 agy 接受的确切 ID；未设置前聊天中没有可选的 Antigravity 模型。',
        'Model id passed to `agy --model` (for example gemini-3.8-flash-low). Antigravity has no model discovery: type the id exactly as your agy accepts it. Until a model id is set, no Antigravity model can be selected in chat.',
      ))
      .addText((text) => {
        text
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- The placeholder is a provider-verbatim model slug, not UI prose.
          .setPlaceholder('gemini-3.8-flash-low')
          .setValue(antigravitySettings.manualModelId)
          .onChange((value) => {
            void persistManualModelId(value);
          });
      });

    const persistTimeoutMs = async (value: string): Promise<void> => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return;
      }

      await context.plugin.mutateSettings((settings) => {
        updateAntigravityProviderSettings(settings, { timeoutMs: parsed });
      });
    };

    new Setting(container)
      .setName(localeText('单轮超时（毫秒）', 'Turn timeout (ms)'))
      .setDesc(localeText(
        '单次 agy 调用的超时时间（毫秒）；超时后该轮会被终止。',
        'Per-turn timeout for one agy call in milliseconds; the turn is terminated when it expires.',
      ))
      .addText((text) => {
        text
          .setPlaceholder(String(ANTIGRAVITY_DEFAULT_TIMEOUT_MS))
          .setValue(String(antigravitySettings.timeoutMs))
          .onChange((value) => {
            void persistTimeoutMs(value);
          });
      });

    new Setting(container).setName(localeText('诊断', 'Diagnostics')).setHeading();

    const diagnosticsEl = container.createDiv({ cls: 'claudian-plus-sp-settings-desc' });
    const renderDiagnostics = (includeResolution: boolean): void => {
      diagnosticsEl.empty();
      const current = getAntigravityProviderSettings(settingsBag);
      const configuredPath = current.cliPathsByHost[hostnameKey] || '';
      const resolvedPath = includeResolution
        ? (workspace?.cliResolver?.resolveFromSettings(settingsBag) ?? null)
        : null;
      const resolvedLabel = !includeResolution
        ? localeText('尚未检查', 'not checked yet')
        : (resolvedPath ?? localeText('未找到 agy', 'agy not found'));

      diagnosticsEl.createEl('p', {
        cls: 'setting-item-description',
        text: localeText(
          `状态：${current.enabled ? '已启用' : '未启用'}；本机 CLI 路径：${configuredPath || '未设置，使用 PATH 中的 agy'}；解析：${resolvedLabel}；模型 ID：${current.manualModelId || '未设置'}；超时：${current.timeoutMs} ms`,
          `State: ${current.enabled ? 'enabled' : 'disabled'}; CLI path for this host: ${configuredPath || 'not set, uses agy from PATH'}; resolved: ${resolvedLabel}; model id: ${current.manualModelId || 'not set'}; timeout: ${current.timeoutMs} ms`,
        ),
      });
      diagnosticsEl.createEl('p', {
        cls: 'setting-item-description',
        text: describeAntigravityLastFailure(current.lastFailure),
      });
      diagnosticsEl.createEl('p', {
        cls: 'setting-item-description',
        text: localeText(
          '诊断只读取本地已知状态：不会启动 agy，也不会发起任何模型请求。模型消耗遵循你 Antigravity 账户自身的 `agy` 配置。',
          'Diagnostics read locally known state only: the agy CLI is never launched and no model request is ever issued. Consumption follows your Antigravity account\'s own `agy` configuration.',
        ),
      });
    };
    renderDiagnostics(false);

    new Setting(container)
      .setName(localeText('刷新诊断', 'Refresh diagnostics'))
      .setDesc(localeText(
        '重新读取本地已知状态（启用状态、CLI 路径解析、模型 ID、超时）。',
        'Re-reads locally known state (enabled flag, CLI path resolution, model id, timeout).',
      ))
      .addButton((button) =>
        button
          .setButtonText(localeText('刷新', 'Refresh'))
          .onClick(async () => {
            await context.plugin.mutateSettings((settings) => {
              requestAntigravityDiagnosticsRefresh(settings);
            });
            renderDiagnostics(true);
          })
      );

    new Setting(container)
      .setName(localeText('复制诊断快照', 'Copy diagnostics snapshot'))
      .setDesc(localeText(
        '复制一份已脱敏的本地诊断快照：插件版本、提供商 ID、CLI 可执行文件名、CLI 解析结果、能力声明，以及最近一次失败类别。快照只读取本地已知状态：不会启动 agy，也不会发起模型请求；主机名、私有路径、邮箱、令牌和提示词内容都会被移除。',
        'Copies a redacted local snapshot: plugin version, provider id, CLI executable name, CLI resolution result, capability statement, and the last failure category. It reads locally known state only — the CLI is never launched and no model request is issued — and it removes host names, private paths, emails, tokens, and prompt content.',
      ))
      .addButton((button) =>
        button
          .setButtonText(localeText('复制', 'Copy'))
          .onClick(async () => {
            const report = formatAntigravityDiagnosticsReport({
              pluginVersion: context.plugin.manifest?.version ?? null,
              resolvedCliPath: await resolveCliPathForDiagnostics(workspace, settingsBag),
              capabilities: ANTIGRAVITY_PROVIDER_CAPABILITIES,
              lastFailure: getAntigravityProviderSettings(settingsBag).lastFailure,
            });
            try {
              await navigator.clipboard.writeText(report);
              new Notice(localeText('诊断快照已复制（已脱敏）', 'Diagnostics snapshot copied (redacted)'));
            } catch {
              new Notice(localeText('无法复制诊断快照', 'Could not copy the diagnostics snapshot'));
            }
          })
      );
  },
};

/**
 * Resolves the CLI path for the snapshot. The shared resolver contract allows a
 * promise, so both shapes are accepted; resolution is a filesystem/PATH lookup
 * that never launches the CLI.
 */
async function resolveCliPathForDiagnostics(
  workspace: AntigravityWorkspaceServices | null,
  settingsBag: Record<string, unknown>,
): Promise<string | null> {
  const resolution = workspace?.cliResolver?.resolveFromSettings(settingsBag);
  if (resolution === undefined || resolution === null) {
    return null;
  }
  return typeof resolution === 'string' ? resolution : await resolution;
}

function describeAntigravityLastFailure(failure: AntigravityLastFailure | null): string {
  if (!failure) {
    return localeText('最近一次失败：无记录', 'Last failure: nothing recorded');
  }
  const recordedAt = new Date(failure.recordedAt).toLocaleString();
  return localeText(
    `最近一次失败：${failure.category}（${recordedAt}）${failure.detail ? ` — ${failure.detail}` : ''}`,
    `Last failure: ${failure.category} at ${recordedAt}${failure.detail ? ` — ${failure.detail}` : ''}`,
  );
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
