import type { App } from 'obsidian';
import { Modal, Notice, setIcon, Setting } from 'obsidian';

import {
  getEnvironmentScopeUpdates,
  resolveEnvironmentSnippetScope,
} from '../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../core/providers/ProviderHost';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type { EnvironmentScope, EnvSnippet } from '../../core/types';
import { VIEW_TYPE_CLAUDIAN_PLUS } from '../../core/types/chat';
import { localeText, t } from '../../i18n/i18n';
import { formatContextLimit, parseContextLimit, parseEnvironmentVariables } from '../../utils/env';
import { confirmDelete } from '../modals/ConfirmModal';

export class EnvSnippetModal extends Modal {
  plugin: ProviderHost;
  snippet: EnvSnippet | null;
  snippetScope: EnvironmentScope;
  onSave: (snippet: EnvSnippet) => void;

  constructor(
    app: App,
    plugin: ProviderHost,
    snippet: EnvSnippet | null,
    scope: EnvironmentScope,
    onSave: (snippet: EnvSnippet) => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.snippet = snippet;
    this.snippetScope = scope;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    this.setTitle(this.snippet ? t('settings.envSnippets.modal.titleEdit') : t('settings.envSnippets.modal.titleSave'));

    this.modalEl.addClass('claudian-plus-env-snippet-modal');

    let nameEl: HTMLInputElement;
    let descEl: HTMLInputElement;
    let envVarsEl: HTMLTextAreaElement;
    const contextLimitInputs: Map<string, HTMLInputElement> = new Map();
    const modelAliasInputs: Map<string, HTMLInputElement> = new Map();
    let contextLimitsContainer: HTMLElement | null = null;

    // !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        saveSnippet();
      } else if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        this.close();
      }
    };

    const saveSnippet = () => {
      const name = nameEl.value.trim();
      if (!name) {
        new Notice(t('settings.envSnippets.nameRequired'));
        return;
      }

      const contextLimits: Record<string, number> = {};
      for (const [modelId, input] of contextLimitInputs) {
        const value = input.value.trim();
        if (value) {
          const parsed = parseContextLimit(value);
          if (parsed !== null) {
            contextLimits[modelId] = parsed;
          }
        }
      }

      const modelAliases: Record<string, string> = {};
      for (const [modelId, input] of modelAliasInputs) {
        const value = input.value.trim();
        if (value) {
          modelAliases[modelId] = value;
        }
      }

      const snippet: EnvSnippet = {
        id: this.snippet?.id || `snippet-${Date.now()}`,
        name,
        description: descEl.value.trim(),
        envVars: envVarsEl.value,
        scope: resolveEnvironmentSnippetScope(
          envVarsEl.value,
          this.snippet?.scope ?? this.snippetScope,
        ),
        contextLimits: Object.keys(contextLimits).length > 0 ? contextLimits : undefined,
        modelAliases: modelAliasInputs.size > 0 ? modelAliases : undefined,
      };

      this.onSave(snippet);
      this.close();
    };

    const renderContextLimitFields = () => {
      if (!contextLimitsContainer) return;
      contextLimitsContainer.empty();
      contextLimitInputs.clear();
      modelAliasInputs.clear();

      const envVars = parseEnvironmentVariables(envVarsEl.value);
      const uniqueModelIds = ProviderRegistry.getCustomModelIds(envVars);

      if (uniqueModelIds.size === 0) {
        contextLimitsContainer.addClass('claudian-plus-hidden');
        return;
      }

      contextLimitsContainer.removeClass('claudian-plus-hidden');

      const existingLimits = this.snippet?.contextLimits ?? this.plugin.settings.customContextLimits ?? {};
      const existingAliases = this.snippet?.modelAliases ?? this.plugin.settings.customModelAliases ?? {};

      contextLimitsContainer.createDiv({
        text: t('settings.customModelOverrides.name'),
        cls: 'setting-item-name',
      });
      contextLimitsContainer.createDiv({
        text: t('settings.customModelOverrides.desc'),
        cls: 'setting-item-description',
      });

      for (const modelId of uniqueModelIds) {
        const row = contextLimitsContainer.createDiv({ cls: 'claudian-plus-snippet-limit-row' });
        row.createSpan({ text: modelId, cls: 'claudian-plus-snippet-limit-model' });
        row.createSpan({ cls: 'claudian-plus-snippet-limit-spacer' });

        const aliasInput = row.createEl('input', {
          type: 'text',
          placeholder: t('settings.customModelAliases.placeholder'),
          cls: 'claudian-plus-snippet-alias-input',
        });
        aliasInput.value = existingAliases[modelId] ?? '';
        aliasInput.setAttribute('aria-label', localeText(`为 ${modelId} 设置别名`, `Alias for ${modelId}`));
        aliasInput.title = localeText('显示在模型选择器中的自定义标签。留空则使用默认值。', 'Custom label shown in the model selector. Leave empty to use the default.');
        modelAliasInputs.set(modelId, aliasInput);

        const input = row.createEl('input', {
          type: 'text',
          placeholder: '200k',
          cls: 'claudian-plus-snippet-limit-input',
        });
        input.value = existingLimits[modelId] ? formatContextLimit(existingLimits[modelId]) : '';
        input.setAttribute('aria-label', localeText(`${modelId} 的上下文窗口`, `Context window for ${modelId}`));
        contextLimitInputs.set(modelId, input);
      }
    };

    new Setting(contentEl)
      .setName(t('settings.envSnippets.modal.name'))
      .setDesc(t('settings.envSnippets.modal.namePlaceholder'))
      .addText((text) => {
        nameEl = text.inputEl;
        text.setValue(this.snippet?.name || '');
                text.inputEl.addEventListener('keydown', handleKeyDown);
      });

    new Setting(contentEl)
      .setName(t('settings.envSnippets.modal.description'))
      .setDesc(t('settings.envSnippets.modal.descPlaceholder'))
      .addText((text) => {
        descEl = text.inputEl;
        text.setValue(this.snippet?.description || '');
                text.inputEl.addEventListener('keydown', handleKeyDown);
      });

    const envVarsSetting = new Setting(contentEl)
      .setName(t('settings.envSnippets.modal.envVars'))
      .setDesc(t('settings.envSnippets.modal.envVarsPlaceholder'))
      .addTextArea((text) => {
        envVarsEl = text.inputEl;
        const envVarsToShow = this.snippet?.envVars ?? this.plugin.getEnvironmentVariablesForScope(this.snippetScope);
        text.setValue(envVarsToShow);
        text.inputEl.rows = 8;
        text.inputEl.addEventListener('blur', () => renderContextLimitFields());
      });
    envVarsSetting.settingEl.addClass('claudian-plus-env-snippet-setting');
    envVarsSetting.controlEl.addClass('claudian-plus-env-snippet-control');

    contextLimitsContainer = contentEl.createDiv({ cls: 'claudian-plus-snippet-context-limits' });
    renderContextLimitFields();

    const buttonContainer = contentEl.createDiv({ cls: 'claudian-plus-snippet-buttons' });

    const cancelBtn = buttonContainer.createEl('button', {
      text: t('settings.envSnippets.modal.cancel'),
      cls: 'claudian-plus-cancel-btn'
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: this.snippet ? t('settings.envSnippets.modal.update') : t('settings.envSnippets.modal.save'),
      cls: 'claudian-plus-save-btn'
    });
    saveBtn.addEventListener('click', () => saveSnippet());

    // Focus name input after modal is rendered (timeout for Windows compatibility)
    window.setTimeout(() => nameEl?.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class EnvSnippetManager {
  private containerEl: HTMLElement;
  private plugin: ProviderHost;
  private scope: EnvironmentScope;
  private onContextLimitsChange?: () => void;

  constructor(
    containerEl: HTMLElement,
    plugin: ProviderHost,
    scope: EnvironmentScope,
    onContextLimitsChange?: () => void,
  ) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.scope = scope;
    this.onContextLimitsChange = onContextLimitsChange;
    this.render();
  }

  private render() {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-plus-snippet-header' });
    headerEl.createSpan({ text: t('settings.envSnippets.name'), cls: 'claudian-plus-snippet-label' });

    const saveBtn = headerEl.createEl('button', {
      cls: 'claudian-plus-settings-action-btn',
      attr: { 'aria-label': t('settings.envSnippets.addBtn') },
    });
    setIcon(saveBtn, 'plus');
    saveBtn.addEventListener('click', () => {
      void this.saveCurrentEnv();
    });

    const snippets = this.plugin.settings.envSnippets.filter((snippet) => this.shouldDisplaySnippet(snippet));

    if (snippets.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'claudian-plus-snippet-empty' });
      emptyEl.setText(t('settings.envSnippets.noSnippets'));
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'claudian-plus-snippet-list' });

    for (const snippet of snippets) {
      const itemEl = listEl.createDiv({ cls: 'claudian-plus-snippet-item' });

      const infoEl = itemEl.createDiv({ cls: 'claudian-plus-snippet-info' });

      const nameEl = infoEl.createDiv({ cls: 'claudian-plus-snippet-name' });
      nameEl.setText(snippet.name);

      if (snippet.description) {
        const descEl = infoEl.createDiv({ cls: 'claudian-plus-snippet-description' });
        descEl.setText(snippet.description);
      }

      const actionsEl = itemEl.createDiv({ cls: 'claudian-plus-snippet-actions' });

      const restoreBtn = actionsEl.createEl('button', {
        cls: 'claudian-plus-settings-action-btn',
        attr: { 'aria-label': localeText('插入', 'Insert') },
      });
      setIcon(restoreBtn, 'clipboard-paste');
      restoreBtn.addEventListener('click', () => {
        void (async (): Promise<void> => {
        try {
          await this.insertSnippet(snippet);
        } catch {
          new Notice(localeText('插入片段失败', 'Failed to insert snippet'));
        }
        })();
      });

      const editBtn = actionsEl.createEl('button', {
        cls: 'claudian-plus-settings-action-btn',
        attr: { 'aria-label': localeText('编辑', 'Edit') },
      });
      setIcon(editBtn, 'pencil');
      editBtn.addEventListener('click', () => {
        this.editSnippet(snippet);
      });

      const deleteBtn = actionsEl.createEl('button', {
        cls: 'claudian-plus-settings-action-btn claudian-plus-settings-delete-btn',
        attr: { 'aria-label': localeText('删除', 'Delete') },
      });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.addEventListener('click', () => {
        void (async (): Promise<void> => {
        try {
          if (await confirmDelete(this.plugin.app, localeText(`确定删除环境片段“${snippet.name}”？`, `Delete environment snippet "${snippet.name}"?`))) {
            await this.deleteSnippet(snippet);
          }
        } catch {
          new Notice(localeText('删除片段失败', 'Failed to delete snippet'));
        }
        })();
      });
    }
  }

  private async saveCurrentEnv() {
    const modal = new EnvSnippetModal(
      this.plugin.app,
      this.plugin,
      null,
      this.scope,
      (snippet) => {
        void (async (): Promise<void> => {
          await this.plugin.mutateSettings((settings) => {
            settings.envSnippets.push(snippet);
          });
          this.render();
          new Notice(localeText(`环境片段“${snippet.name}”已保存`, `Environment snippet "${snippet.name}" saved`));
        })();
      }
    );
    modal.open();
  }

  private async insertSnippet(snippet: EnvSnippet) {
    const snippetContent = snippet.envVars.trim();
    const updates = getEnvironmentScopeUpdates(
      snippetContent,
      snippet.scope ?? this.scope,
    );

    if (updates.length === 1) {
      const [update] = updates;
      this.syncTextareaValue(update.scope, update.envText);
      await this.plugin.applyEnvironmentVariables(update.scope, update.envText);
    } else if (updates.length > 1) {
      for (const update of updates) {
        this.syncTextareaValue(update.scope, update.envText);
      }
      await this.plugin.applyEnvironmentVariablesBatch(updates);
    }

    // Legacy snippets without contextLimits don't modify limits
    await this.plugin.mutateSettings((settings) => {
      if (snippet.contextLimits) {
        settings.customContextLimits = {
          ...settings.customContextLimits,
          ...snippet.contextLimits,
        };
      }

      // Legacy snippets without modelAliases don't modify aliases. Snippets saved
      // with alias fields clear aliases for their own model IDs when left empty.
      if (snippet.modelAliases) {
        const modelIds = ProviderRegistry.getCustomModelIds(parseEnvironmentVariables(snippet.envVars));
        const nextAliases = { ...(settings.customModelAliases ?? {}) };
        for (const modelId of modelIds) {
          const alias = snippet.modelAliases[modelId]?.trim();
          if (alias) {
            nextAliases[modelId] = alias;
          } else {
            delete nextAliases[modelId];
          }
        }
        settings.customModelAliases = nextAliases;
      }
    });

    this.onContextLimitsChange?.();
    const view = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_PLUS)[0]?.view as {
      refreshModelSelector?(): void;
    } | undefined;
    view?.refreshModelSelector?.();
  }

  private editSnippet(snippet: EnvSnippet) {
    const modal = new EnvSnippetModal(
      this.plugin.app,
      this.plugin,
      snippet,
      this.scope,
      (updatedSnippet) => {
        void (async (): Promise<void> => {
          const exists = this.plugin.settings.envSnippets.some(s => s.id === snippet.id);
          if (exists) {
            await this.plugin.mutateSettings((settings) => {
              const index = settings.envSnippets.findIndex(s => s.id === snippet.id);
              if (index !== -1) {
                settings.envSnippets[index] = updatedSnippet;
              }
            });
            this.render();
            new Notice(localeText(`环境片段“${updatedSnippet.name}”已更新`, `Environment snippet "${updatedSnippet.name}" updated`));
          }
        })();
      }
    );
    modal.open();
  }

  private async deleteSnippet(snippet: EnvSnippet) {
    await this.plugin.mutateSettings((settings) => {
      settings.envSnippets = settings.envSnippets.filter(s => s.id !== snippet.id);
    });
    this.render();
    new Notice(localeText(`环境片段“${snippet.name}”已删除`, `Environment snippet "${snippet.name}" deleted`));
  }

  public refresh() {
    this.render();
  }

  private shouldDisplaySnippet(snippet: EnvSnippet): boolean {
    if (this.scope === 'shared') {
      return !snippet.scope || snippet.scope === 'shared';
    }

    return snippet.scope === this.scope;
  }

  private syncTextareaValue(scope: EnvironmentScope, value: string): void {
    const selector = `.claudian-plus-settings-env-textarea[data-env-scope="${scope}"]`;
    const envTextarea = (this.containerEl.ownerDocument ?? window.document).querySelector<HTMLTextAreaElement>(selector);
    if (envTextarea) {
      envTextarea.value = value;
    }
  }
}
