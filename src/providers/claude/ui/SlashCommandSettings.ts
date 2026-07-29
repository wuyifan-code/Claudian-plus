import type { App, ToggleComponent } from 'obsidian';
import { Modal, Notice, setIcon, Setting } from 'obsidian';

import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { localeText, t } from '../../../i18n/i18n';
import { extractFirstParagraph, normalizeArgumentHint, parseSlashCommandContent, validateCommandName } from '../../../utils/slashCommand';

function resolveAllowedTools(inputValue: string, parsedTools?: string[]): string[] | undefined {
  const trimmed = inputValue.trim();
  if (trimmed) {
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (parsedTools && parsedTools.length > 0) {
    return parsedTools;
  }
  return undefined;
}

function isSkillEntry(entry: ProviderCommandEntry): boolean {
  return entry.kind === 'skill';
}

export class SlashCommandModal extends Modal {
  private entries: ProviderCommandEntry[];
  private existingEntry: ProviderCommandEntry | null;
  private onSave: (entry: ProviderCommandEntry) => Promise<void>;

  constructor(
    app: App,
    entries: ProviderCommandEntry[],
    existingEntry: ProviderCommandEntry | null,
    onSave: (entry: ProviderCommandEntry) => Promise<void>,
  ) {
    super(app);
    this.entries = entries;
    this.existingEntry = existingEntry;
    this.onSave = onSave;
  }

  onOpen() {
    const existingIsSkill = this.existingEntry ? isSkillEntry(this.existingEntry) : false;
    let selectedType: 'command' | 'skill' = existingIsSkill ? 'skill' : 'command';

    const typeLabel = () => selectedType === 'skill' ? localeText('技能', 'Skill') : localeText('斜杠命令', 'Slash Command');

    this.setTitle(this.existingEntry ? `Edit ${typeLabel()}` : `Add ${typeLabel()}`);
    this.modalEl.addClass('claudian-plus-sp-modal');

    const { contentEl } = this;

    let nameInput: HTMLInputElement;
    let descInput: HTMLInputElement;
    let hintInput: HTMLInputElement;
    let modelInput: HTMLInputElement;
    let toolsInput: HTMLInputElement;
    let disableModelToggle = this.existingEntry?.disableModelInvocation ?? false;
    let disableUserInvocation = this.existingEntry?.userInvocable === false;
    let contextValue: 'fork' | '' = this.existingEntry?.context ?? '';
    let agentInput: HTMLInputElement;

    let disableUserSetting: Setting | null = null;
    let disableUserToggle: ToggleComponent | null = null;

    const updateSkillOnlyFields = () => {
      if (!disableUserSetting || !disableUserToggle) return;

      const isSkillType = selectedType === 'skill';
      disableUserSetting.settingEl.toggleClass('claudian-plus-hidden', !isSkillType);
      if (!isSkillType) {
        disableUserInvocation = false;
        disableUserToggle.setValue(false);
      }
    };

    new Setting(contentEl)
      .setName(localeText('类型', 'Type'))
      .setDesc(localeText('命令或技能', 'Command or skill'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('command', localeText('命令', 'Command'))
          .addOption('skill', localeText('技能', 'Skill'))
          .setValue(selectedType)
          .onChange(value => {
            selectedType = value as 'command' | 'skill';
            this.setTitle(this.existingEntry ? `Edit ${typeLabel()}` : `Add ${typeLabel()}`);
            updateSkillOnlyFields();
          });
        if (this.existingEntry) {
          dropdown.setDisabled(true);
        }
      });

    new Setting(contentEl)
      .setName(localeText('命令名称', 'Command name'))
      .setDesc(localeText('在 / 后使用的名称（例如 /review 的名称为“review”）', 'The name used after / (e.g., "review" for /review)'))
      .addText(text => {
        nameInput = text.inputEl;
        text.setValue(this.existingEntry?.name || '')
          .setPlaceholder('Review-code');
      });

    new Setting(contentEl)
      .setName(localeText('描述', 'Description'))
      .setDesc(localeText('显示在下拉菜单中的可选描述', 'Optional description shown in dropdown'))
      .addText(text => {
        descInput = text.inputEl;
        text.setValue(this.existingEntry?.description || '');
      });

    const details = contentEl.createEl('details', { cls: 'claudian-plus-sp-advanced-section' });
    details.createEl('summary', {
      text: localeText('高级选项', 'Advanced options'),
      cls: 'claudian-plus-sp-advanced-summary',
    });
    if (
      this.existingEntry?.argumentHint
      || this.existingEntry?.model
      || this.existingEntry?.allowedTools?.length
      || this.existingEntry?.disableModelInvocation
      || this.existingEntry?.userInvocable === false
      || this.existingEntry?.context
      || this.existingEntry?.agent
    ) {
      details.open = true;
    }

    new Setting(details)
      .setName(localeText('参数提示', 'Argument hint'))
      .setDesc(localeText('参数的占位文本（例如“[file] [focus]”）', 'Placeholder text for arguments (e.g., "[file] [focus]")'))
      .addText(text => {
        hintInput = text.inputEl;
        text.setValue(this.existingEntry?.argumentHint || '');
      });

    new Setting(details)
      .setName(localeText('模型覆盖', 'Model override'))
      .setDesc(localeText('此命令使用的可选模型', 'Optional model to use for this command'))
      .addText(text => {
        modelInput = text.inputEl;
        text.setValue(this.existingEntry?.model || '')
          .setPlaceholder('Claude-sonnet-4-5');
      });

    new Setting(details)
      .setName(localeText('允许的工具', 'Allowed tools'))
      .setDesc(localeText('允许使用的工具列表，以逗号分隔（留空表示全部）', 'Comma-separated list of tools to allow (empty = all)'))
      .addText(text => {
        toolsInput = text.inputEl;
        text.setValue(this.existingEntry?.allowedTools?.join(', ') || '');
      });

    new Setting(details)
      .setName(localeText('禁止模型调用', 'Disable model invocation'))
      .setDesc(localeText('禁止模型主动调用此命令', 'Prevent the model from invoking this command itself'))
      .addToggle(toggle => {
        toggle.setValue(disableModelToggle)
          .onChange(value => { disableModelToggle = value; });
      });

    disableUserSetting = new Setting(details)
      .setName(localeText('禁止用户调用', 'Disable user invocation'))
      .setDesc(localeText('禁止用户直接调用此技能', 'Prevent the user from invoking this skill directly'))
      .addToggle(toggle => {
        disableUserToggle = toggle;
        toggle.setValue(disableUserInvocation)
          .onChange(value => { disableUserInvocation = value; });
      });

    updateSkillOnlyFields();

    new Setting(details)
      .setName(localeText('上下文', 'Context'))
      .setDesc(localeText('在子代理（分支）中运行', 'Run in a subagent (fork)'))
      .addToggle(toggle => {
        toggle.setValue(contextValue === 'fork')
          .onChange(value => {
            contextValue = value ? 'fork' : '';
            agentSetting.settingEl.toggleClass('claudian-plus-hidden', !value);
          });
      });

    const agentSetting = new Setting(details)
      .setName(localeText('代理', 'Agent'))
      .setDesc(localeText('上下文使用分支时的子代理类型', 'Subagent type when context is fork'))
      .addText(text => {
        agentInput = text.inputEl;
        text.setValue(this.existingEntry?.agent || '')
          .setPlaceholder('Code-reviewer');
      });
    agentSetting.settingEl.toggleClass('claudian-plus-hidden', contextValue !== 'fork');

    new Setting(contentEl)
      .setName(localeText('提示词模板', 'Prompt template'))
      .setDesc(localeText('可使用 $ARGUMENTS、$1、$2、@file、!`bash`', 'Use $ARGUMENTS, $1, $2, @file, !`bash`'));

    const contentArea = contentEl.createEl('textarea', {
      cls: 'claudian-plus-sp-content-area',
      attr: {
        rows: '10',
        placeholder: 'Review this code for:\n$ARGUMENTS\n\n@$1',
      },
    });
    const initialContent = this.existingEntry
      ? parseSlashCommandContent(this.existingEntry.content).promptContent
      : '';
    contentArea.value = initialContent;

    const buttonContainer = contentEl.createDiv({ cls: 'claudian-plus-sp-modal-buttons' });

    const cancelBtn = buttonContainer.createEl('button', {
      text: localeText('取消', 'Cancel'),
      cls: 'claudian-plus-cancel-btn',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: localeText('保存', 'Save'),
      cls: 'claudian-plus-save-btn',
    });
    saveBtn.addEventListener('click', () => {
      void (async (): Promise<void> => {
      const name = nameInput.value.trim();
      const nameError = validateCommandName(name);
      if (nameError) {
        new Notice(nameError);
        return;
      }

      const content = contentArea.value;
      if (!content.trim()) {
        new Notice(localeText('提示词模板不能为空', 'Prompt template is required'));
        return;
      }

      const existing = this.entries.find(
        entry => entry.name.toLowerCase() === name.toLowerCase()
          && entry.id !== this.existingEntry?.id,
      );
      if (existing) {
        new Notice(localeText(`名为“/${name}”的命令已存在`, `A command named "/${name}" already exists`));
        return;
      }

      const parsed = parseSlashCommandContent(content);
      const promptContent = parsed.promptContent;
      const isSkillType = selectedType === 'skill';

      const entry: ProviderCommandEntry = {
        id: this.existingEntry?.id || (
          isSkillType
            ? `skill-${name}`
            : `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
        ),
        providerId: 'claude',
        kind: isSkillType ? 'skill' : 'command',
        name,
        description: descInput.value.trim() || parsed.description || undefined,
        argumentHint: normalizeArgumentHint(hintInput.value.trim()) || parsed.argumentHint || undefined,
        allowedTools: resolveAllowedTools(toolsInput.value, parsed.allowedTools),
        model: modelInput.value.trim() || parsed.model || undefined,
        content: promptContent,
        disableModelInvocation: disableModelToggle || undefined,
        userInvocable: disableUserInvocation ? false : undefined,
        context: contextValue || undefined,
        agent: contextValue === 'fork' ? (agentInput.value.trim() || undefined) : undefined,
        hooks: parsed.hooks ?? this.existingEntry?.hooks,
        scope: 'vault',
        source: this.existingEntry?.source ?? 'user',
        isEditable: true,
        isDeletable: true,
        displayPrefix: '/',
        insertPrefix: '/',
        persistenceKey: this.existingEntry?.persistenceKey,
      };

      try {
        await this.onSave(entry);
      } catch {
        const label = isSkillType ? localeText('技能', 'skill') : localeText('斜杠命令', 'slash command');
        new Notice(localeText(`保存${label}失败`, `Failed to save ${label}`));
        return;
      }
      this.close();
      })();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    };
    contentEl.addEventListener('keydown', handleKeyDown);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class SlashCommandSettings {
  private app: App;
  private containerEl: HTMLElement;
  private catalog: ProviderCommandCatalog | null;
  private commands: ProviderCommandEntry[] = [];

  constructor(
    containerEl: HTMLElement,
    app: App,
    catalog: ProviderCommandCatalog | null,
  ) {
    this.app = app;
    this.containerEl = containerEl;
    this.catalog = catalog;
    void this.loadAndRender();
  }

  private async loadAndRender(): Promise<void> {
    if (!this.catalog) {
      this.renderUnavailable();
      return;
    }

    this.commands = await this.catalog.listVaultEntries();
    this.render();
  }

  private renderUnavailable(): void {
    this.containerEl.empty();
    const emptyEl = this.containerEl.createDiv({ cls: 'claudian-plus-sp-empty-state' });
    emptyEl.setText(localeText('Claude 命令目录不可用。', 'Claude command catalog is unavailable.'));
  }

  private render(): void {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-plus-sp-header' });
    headerEl.createSpan({ text: t('settings.slashCommands.name'), cls: 'claudian-plus-sp-label' });

    const actionsEl = headerEl.createDiv({ cls: 'claudian-plus-sp-header-actions' });

    const addBtn = actionsEl.createEl('button', {
      cls: 'claudian-plus-settings-action-btn',
      attr: { 'aria-label': localeText('添加', 'Add') },
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', () => this.openCommandModal(null));

    if (this.commands.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'claudian-plus-sp-empty-state' });
      emptyEl.setText(localeText('尚未配置命令或技能。点击 + 创建一个。', 'No commands or skills configured. Click + to create one.'));
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'claudian-plus-sp-list' });

    for (const cmd of this.commands) {
      this.renderCommandItem(listEl, cmd);
    }
  }

  private renderCommandItem(listEl: HTMLElement, cmd: ProviderCommandEntry): void {
    const itemEl = listEl.createDiv({ cls: 'claudian-plus-sp-item' });

    const infoEl = itemEl.createDiv({ cls: 'claudian-plus-sp-info' });

    const headerRow = infoEl.createDiv({ cls: 'claudian-plus-sp-item-header' });

    const nameEl = headerRow.createSpan({ cls: 'claudian-plus-sp-item-name' });
    nameEl.setText(`/${cmd.name}`);

    if (isSkillEntry(cmd)) {
      headerRow.createSpan({ text: localeText('技能', 'skill'), cls: 'claudian-plus-slash-item-badge' });
    }

    if (cmd.argumentHint) {
      const hintEl = headerRow.createSpan({ cls: 'claudian-plus-slash-item-hint' });
      hintEl.setText(cmd.argumentHint);
    }

    if (cmd.description) {
      const descEl = infoEl.createDiv({ cls: 'claudian-plus-sp-item-desc' });
      descEl.setText(cmd.description);
    }

    const actionsEl = itemEl.createDiv({ cls: 'claudian-plus-sp-item-actions' });

    if (cmd.isEditable) {
      const editBtn = actionsEl.createEl('button', {
        cls: 'claudian-plus-settings-action-btn',
        attr: { 'aria-label': localeText('编辑', 'Edit') },
      });
      setIcon(editBtn, 'pencil');
      editBtn.addEventListener('click', () => this.openCommandModal(cmd));
    }

    if (!isSkillEntry(cmd) && cmd.isEditable) {
      const convertBtn = actionsEl.createEl('button', {
        cls: 'claudian-plus-settings-action-btn',
        attr: { 'aria-label': localeText('转换为技能', 'Convert to skill') },
      });
      setIcon(convertBtn, 'package');
      convertBtn.addEventListener('click', () => {
        void (async (): Promise<void> => {
        try {
          await this.transformToSkill(cmd);
        } catch {
          new Notice(localeText('转换为技能失败', 'Failed to convert to skill'));
        }
        })();
      });
    }

    if (cmd.isDeletable) {
      const deleteBtn = actionsEl.createEl('button', {
        cls: 'claudian-plus-settings-action-btn claudian-plus-settings-delete-btn',
        attr: { 'aria-label': localeText('删除', 'Delete') },
      });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.addEventListener('click', () => {
        void (async (): Promise<void> => {
        try {
          await this.deleteCommand(cmd);
        } catch {
          const label = isSkillEntry(cmd) ? localeText('技能', 'skill') : localeText('斜杠命令', 'slash command');
          new Notice(localeText(`删除${label}失败`, `Failed to delete ${label}`));
        }
        })();
      });
    }
  }

  private openCommandModal(existingCmd: ProviderCommandEntry | null): void {
    const modal = new SlashCommandModal(
      this.app,
      this.commands,
      existingCmd,
      async (cmd) => {
        await this.saveCommand(cmd, existingCmd);
      },
    );
    modal.open();
  }

  private async saveCommand(cmd: ProviderCommandEntry, existing: ProviderCommandEntry | null): Promise<void> {
    if (!this.catalog) {
      return;
    }

    await this.catalog.saveVaultEntry(cmd);

    if (existing && existing.name !== cmd.name) {
      await this.catalog.deleteVaultEntry(existing);
    }

    await this.reloadCommands();

    this.render();
    const label = isSkillEntry(cmd) ? localeText('技能', 'Skill') : localeText('斜杠命令', 'Slash command');
    new Notice(localeText(
      `${label} “/${cmd.name}”${existing ? '已更新' : '已创建'}`,
      `${label} "/${cmd.name}" ${existing ? 'updated' : 'created'}`,
    ));
  }

  private async deleteCommand(cmd: ProviderCommandEntry): Promise<void> {
    if (!this.catalog) {
      return;
    }

    await this.catalog.deleteVaultEntry(cmd);

    await this.reloadCommands();

    this.render();
    const label = isSkillEntry(cmd) ? localeText('技能', 'Skill') : localeText('斜杠命令', 'Slash command');
    new Notice(localeText(`${label} “/${cmd.name}”已删除`, `${label} "/${cmd.name}" deleted`));
  }

  private async transformToSkill(cmd: ProviderCommandEntry): Promise<void> {
    if (!this.catalog) {
      return;
    }

    const skillName = cmd.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64);

    const existingSkill = this.commands.find(
      entry => isSkillEntry(entry) && entry.name === skillName,
    );
    if (existingSkill) {
      new Notice(localeText(`名为“/${skillName}”的技能已存在`, `A skill named "/${skillName}" already exists`));
      return;
    }

    const skill: ProviderCommandEntry = {
      ...cmd,
      id: `skill-${skillName}`,
      kind: 'skill',
      name: skillName,
      description: cmd.description || extractFirstParagraph(cmd.content),
      source: 'user',
      scope: 'vault',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/',
      insertPrefix: '/',
    };

    await this.catalog.saveVaultEntry(skill);
    await this.catalog.deleteVaultEntry(cmd);

    await this.reloadCommands();
    this.render();
    new Notice(localeText(`已将“/${cmd.name}”转换为技能`, `Converted "/${cmd.name}" to skill`));
  }

  private async reloadCommands(): Promise<void> {
    if (!this.catalog) {
      this.commands = [];
      return;
    }

    this.commands = await this.catalog.listVaultEntries();
  }

  public refresh(): void {
    void this.loadAndRender();
  }
}
