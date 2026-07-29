import type { App } from 'obsidian';
import { Modal, Notice, setIcon, Setting } from 'obsidian';

import { localeText } from '../../../i18n/i18n';
import { confirmDelete } from '../../../shared/modals/ConfirmModal';
import type { OpencodeAgentStorage } from '../storage/OpencodeAgentStorage';
import type { OpencodeAgentDefinition } from '../types/agent';

const OPENCODE_AGENT_INVALID_SEGMENT_PATTERN = /[<>:"\\|?*]/;

export function validateOpencodeAgentName(name: string): string | null {
  if (!name) return localeText('必须填写代理名称', 'Agent name is required');

  const segments = name.split('/');
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return localeText('代理名称必须使用以斜杠分隔的路径片段，且不能以斜杠开头或结尾', 'Agent name must use slash-separated path segments without leading or trailing slashes');
  }

  for (const segment of segments) {
    if (!segment.trim()) {
      return localeText('代理名称路径片段不能为空或只能包含空白字符', 'Agent name path segments cannot be empty or whitespace-only');
    }

    if (segment !== segment.trim()) {
      return localeText('代理名称路径片段不能以空白字符开头或结尾', 'Agent name path segments cannot start or end with whitespace');
    }

    if (segment === '.' || segment === '..') {
      return localeText('代理名称不能包含“.”或“..”路径片段', 'Agent name cannot include "." or ".." path segments');
    }

    if (segment.includes('\0') || OPENCODE_AGENT_INVALID_SEGMENT_PATTERN.test(segment)) {
      return localeText('代理名称路径片段不能包含 Windows 保留文件名字符', 'Agent name path segments cannot contain Windows-reserved filename characters');
    }
  }

  return null;
}

export function findOpencodeAgentNameConflict(
  agents: OpencodeAgentDefinition[],
  name: string,
  currentPersistenceKey?: string,
): OpencodeAgentDefinition | null {
  const normalizedName = name.toLowerCase();
  return agents.find(
    (agent) => agent.name.toLowerCase() === normalizedName
      && agent.persistenceKey !== currentPersistenceKey,
  ) ?? null;
}

class OpencodeAgentModal extends Modal {
  private existing: OpencodeAgentDefinition | null;
  private allAgents: OpencodeAgentDefinition[];
  private onSave: (agent: OpencodeAgentDefinition) => Promise<void>;

  constructor(
    app: App,
    existing: OpencodeAgentDefinition | null,
    allAgents: OpencodeAgentDefinition[],
    onSave: (agent: OpencodeAgentDefinition) => Promise<void>,
  ) {
    super(app);
    this.existing = existing;
    this.allAgents = allAgents;
    this.onSave = onSave;
  }

  onOpen() {
    this.setTitle(this.existing ? localeText('编辑 OpenCode 子代理', 'Edit OpenCode Subagent') : localeText('添加 OpenCode 子代理', 'Add OpenCode Subagent'));
    this.modalEl.addClass('claudian-plus-sp-modal');

    const { contentEl } = this;

    let nameInput!: HTMLInputElement;
    let descriptionInput!: HTMLInputElement;
    let modelInput!: HTMLInputElement;
    let variantInput!: HTMLInputElement;
    let temperatureInput!: HTMLInputElement;
    let topPInput!: HTMLInputElement;
    let colorInput!: HTMLInputElement;
    let stepsInput!: HTMLInputElement;
    let hiddenValue = this.existing?.hidden ?? false;
    let disableValue = this.existing?.disable ?? false;
    let toolsInput!: HTMLTextAreaElement;
    let permissionInput!: HTMLTextAreaElement;
    let optionsInput!: HTMLTextAreaElement;

    new Setting(contentEl)
      .setName(localeText('名称', 'Name'))
      .setDesc(localeText('OpenCode 代理名称。嵌套代理请使用斜杠分隔的片段。', 'OpenCode agent name. Use slash-separated segments for nested agents.'))
      .addText((text) => {
        nameInput = text.inputEl;
        text.setValue(this.existing?.name ?? '')
          .setPlaceholder('Review');
      });

    new Setting(contentEl)
      .setName(localeText('描述', 'Description'))
      .setDesc(localeText('说明 OpenCode 应在何时使用此子代理', 'When OpenCode should use this subagent'))
      .addText((text) => {
        descriptionInput = text.inputEl;
        text.setValue(this.existing?.description ?? '')
          .setPlaceholder('Reviews code for correctness and maintainability');
      });

    const details = contentEl.createEl('details', { cls: 'claudian-plus-sp-advanced-section' });
    details.createEl('summary', {
      text: localeText('高级选项', 'Advanced options'),
      cls: 'claudian-plus-sp-advanced-summary',
    });
    if (
      this.existing?.model ||
      this.existing?.variant ||
      this.existing?.temperature !== undefined ||
      this.existing?.topP !== undefined ||
      this.existing?.color ||
      this.existing?.steps !== undefined ||
      this.existing?.hidden ||
      this.existing?.disable ||
      this.existing?.tools ||
      this.existing?.permission !== undefined ||
      this.existing?.options
    ) {
      details.open = true;
    }

    new Setting(details)
      .setName(localeText('模型', 'Model'))
      .setDesc(localeText('以 provider/model 格式覆盖模型', 'Model override in provider/model format'))
      .addText((text) => {
        modelInput = text.inputEl;
        text.setValue(this.existing?.model ?? '')
          .setPlaceholder('Anthropic/Claude-sonnet-4-20250514');
      });

    new Setting(details)
      .setName(localeText('变体', 'Variant'))
      .setDesc(localeText('模型变体覆盖值', 'Model variant override'))
      .addText((text) => {
        variantInput = text.inputEl;
        text.setValue(this.existing?.variant ?? '')
          .setPlaceholder('High');
      });

    new Setting(details)
      .setName(localeText('温度', 'Temperature'))
      .setDesc(localeText('可选的采样温度', 'Optional sampling temperature'))
      .addText((text) => {
        temperatureInput = text.inputEl;
        text.setValue(this.existing?.temperature !== undefined ? String(this.existing.temperature) : '')
          .setPlaceholder('0.1');
      });

    new Setting(details)
      .setName('Top p')
      .setDesc(localeText('可选的 nucleus sampling 值', 'Optional nucleus sampling value'))
      .addText((text) => {
        topPInput = text.inputEl;
        text.setValue(this.existing?.topP !== undefined ? String(this.existing.topP) : '')
          .setPlaceholder('0.9');
      });

    new Setting(details)
      .setName(localeText('颜色', 'Color'))
      .setDesc(localeText('十六进制颜色或主题令牌', 'Hex color or theme token'))
      .addText((text) => {
        colorInput = text.inputEl;
        text.setValue(this.existing?.color ?? '')
          .setPlaceholder('#Ff5733');
      });

    new Setting(details)
      .setName(localeText('步数', 'Steps'))
      .setDesc(localeText('强制仅文本输出前允许的最大代理迭代次数', 'Maximum agentic iterations before forcing text-only output'))
      .addText((text) => {
        stepsInput = text.inputEl;
        text.setValue(this.existing?.steps !== undefined ? String(this.existing.steps) : '')
          .setPlaceholder('10');
      });

    new Setting(details)
      .setName(localeText('从 @ 提及中隐藏', 'Hide from @mention'))
      .setDesc(localeText('从 @ 自动补全菜单中隐藏此子代理', 'Hide this subagent from the @ autocomplete menu'))
      .addToggle((toggle) => {
        toggle.setValue(hiddenValue).onChange((value) => {
          hiddenValue = value;
        });
      });

    new Setting(details)
      .setName(localeText('禁用代理', 'Disable agent'))
      .setDesc(localeText('禁用代理但不删除文件', 'Disable the agent without deleting the file'))
      .addToggle((toggle) => {
        toggle.setValue(disableValue).onChange((value) => {
          disableValue = value;
        });
      });

    new Setting(details)
      .setName(localeText('启用的工具（JSON）', 'Enabled tools (JSON)'))
      .setDesc(localeText('可选的已弃用工具映射，例如 {"write":false,"edit":false}', 'Optional deprecated tools map, e.g. {"write":false,"edit":false}'))
      .addTextArea((text) => {
        toolsInput = text.inputEl;
        text.setValue(this.existing?.tools ? JSON.stringify(this.existing.tools, null, 2) : '')
          .setPlaceholder('{\n  "write": false,\n  "edit": false\n}');
      });

    new Setting(details)
      .setName(localeText('权限（JSON）', 'Permission (JSON)'))
      .setDesc(localeText('可选的权限配置，例如 {"edit":"deny","bash":"allow"}', 'Optional permission config, e.g. {"edit":"deny","bash":"allow"}'))
      .addTextArea((text) => {
        permissionInput = text.inputEl;
        text.setValue(this.existing?.permission !== undefined ? JSON.stringify(this.existing.permission, null, 2) : '')
          .setPlaceholder('{\n  "edit": "deny"\n}');
      });

    new Setting(details)
      .setName(localeText('选项（JSON）', 'Options (JSON)'))
      .setDesc(localeText('可选的自定义代理选项', 'Optional custom agent options'))
      .addTextArea((text) => {
        optionsInput = text.inputEl;
        text.setValue(this.existing?.options ? JSON.stringify(this.existing.options, null, 2) : '')
          .setPlaceholder('{\n  "focus": "security"\n}');
      });

    new Setting(contentEl)
      .setName(localeText('提示词', 'Prompt'))
      .setDesc(localeText('作为代理提示词使用的 Markdown 正文', 'Markdown body used as the agent prompt'));

    const promptArea = contentEl.createEl('textarea', {
      cls: 'claudian-plus-sp-content-area',
      attr: {
        rows: '10',
        placeholder: 'Review code changes carefully and call out correctness, regressions, and missing coverage.',
      },
    });
    promptArea.value = this.existing?.prompt ?? '';

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
      const nameError = validateOpencodeAgentName(name);
      if (nameError) {
        new Notice(nameError);
        return;
      }

      const description = descriptionInput.value.trim();
      if (!description) {
        new Notice(localeText('描述不能为空', 'Description is required'));
        return;
      }

      const prompt = promptArea.value;
      if (!prompt.trim()) {
        new Notice(localeText('提示词不能为空', 'Prompt is required'));
        return;
      }

      const duplicate = findOpencodeAgentNameConflict(
        this.allAgents,
        name,
        this.existing?.persistenceKey,
      );
      if (duplicate) {
        new Notice(localeText(`名为“${name}”的子代理已存在`, `A subagent named "${name}" already exists`));
        return;
      }

      const temperature = parseOptionalNumber(temperatureInput.value, localeText('温度', 'Temperature'));
      if (temperature.error) {
        new Notice(temperature.error);
        return;
      }

      const topP = parseOptionalNumber(topPInput.value, 'Top p');
      if (topP.error) {
        new Notice(topP.error);
        return;
      }

      const steps = parseOptionalPositiveInteger(stepsInput.value, localeText('步数', 'Steps'));
      if (steps.error) {
        new Notice(steps.error);
        return;
      }

      const tools = parseOptionalJsonObjectOfBooleans(toolsInput.value, localeText('启用的工具', 'Enabled Tools'));
      if (tools.error) {
        new Notice(tools.error);
        return;
      }

      const permission = parseOptionalJson(permissionInput.value, localeText('权限', 'Permission'));
      if (permission.error) {
        new Notice(permission.error);
        return;
      }

      const options = parseOptionalJsonObject(optionsInput.value, localeText('选项', 'Options'));
      if (options.error) {
        new Notice(options.error);
        return;
      }

      const agent: OpencodeAgentDefinition = {
        name,
        description,
        prompt,
        mode: 'subagent',
        hidden: hiddenValue || undefined,
        disable: disableValue || undefined,
        model: modelInput.value.trim() || undefined,
        variant: variantInput.value.trim() || undefined,
        temperature: temperature.value,
        topP: topP.value,
        color: colorInput.value.trim() || undefined,
        steps: steps.value,
        tools: tools.value,
        permission: permission.value,
        options: options.value,
        persistenceKey: this.existing?.persistenceKey,
        extraFrontmatter: this.existing?.extraFrontmatter,
      };

      try {
        await this.onSave(agent);
      } catch (error) {
        const message = error instanceof Error ? error.message : localeText('未知错误', 'Unknown error');
        new Notice(localeText(`保存子代理失败：${message}`, `Failed to save subagent: ${message}`));
        return;
      }
      this.close();
      })();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class OpencodeAgentSettings {
  private containerEl: HTMLElement;
  private storage: OpencodeAgentStorage;
  private agents: OpencodeAgentDefinition[] = [];
  private app?: App;
  private onChanged?: () => Promise<void> | void;

  constructor(
    containerEl: HTMLElement,
    storage: OpencodeAgentStorage,
    app?: App,
    onChanged?: () => Promise<void> | void,
  ) {
    this.containerEl = containerEl;
    this.storage = storage;
    this.app = app;
    this.onChanged = onChanged;
    void this.render();
  }

  async render(): Promise<void> {
    this.containerEl.empty();

    try {
      this.agents = await this.storage.loadAll();
    } catch {
      this.agents = [];
    }

    const visibleAgents = this.agents.filter((agent) => agent.mode === 'subagent');

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-plus-sp-header' });
    headerEl.createSpan({ text: localeText('OpenCode 子代理', 'OpenCode Subagents'), cls: 'claudian-plus-sp-label' });

    const actionsEl = headerEl.createDiv({ cls: 'claudian-plus-sp-header-actions' });

    const refreshBtn = actionsEl.createEl('button', {
      cls: 'claudian-plus-settings-action-btn',
      attr: { 'aria-label': localeText('刷新', 'Refresh') },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => { void this.render(); });

    const addBtn = actionsEl.createEl('button', {
      cls: 'claudian-plus-settings-action-btn',
      attr: { 'aria-label': localeText('添加', 'Add') },
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', () => this.openModal(null));

    if (visibleAgents.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'claudian-plus-sp-empty-state' });
      emptyEl.setText(localeText('Vault 中尚未配置 OpenCode 子代理。点击 + 创建一个。', 'No OpenCode subagents in vault. Click + to create one.'));
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'claudian-plus-sp-list' });
    for (const agent of visibleAgents) {
      this.renderItem(listEl, agent);
    }
  }

  private renderItem(listEl: HTMLElement, agent: OpencodeAgentDefinition): void {
    const itemEl = listEl.createDiv({ cls: 'claudian-plus-sp-item' });
    const infoEl = itemEl.createDiv({ cls: 'claudian-plus-sp-info' });

    const headerRow = infoEl.createDiv({ cls: 'claudian-plus-sp-item-header' });
    const nameEl = headerRow.createSpan({ cls: 'claudian-plus-sp-item-name' });
    nameEl.setText(agent.name);

    headerRow.createSpan({
      text: localeText('子代理', 'subagent'),
      cls: 'claudian-plus-slash-item-badge',
    });

    if (agent.model) {
      headerRow.createSpan({ text: agent.model, cls: 'claudian-plus-slash-item-badge' });
    }

    if (agent.description) {
      const descEl = infoEl.createDiv({ cls: 'claudian-plus-sp-item-desc' });
      descEl.setText(agent.description);
    }

    const actionsEl = itemEl.createDiv({ cls: 'claudian-plus-sp-item-actions' });

    const editBtn = actionsEl.createEl('button', {
      cls: 'claudian-plus-settings-action-btn',
      attr: { 'aria-label': localeText('编辑', 'Edit') },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', () => this.openModal(agent));

    const deleteBtn = actionsEl.createEl('button', {
      cls: 'claudian-plus-settings-action-btn claudian-plus-settings-delete-btn',
      attr: { 'aria-label': localeText('删除', 'Delete') },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.addEventListener('click', () => {
      void (async (): Promise<void> => {
      if (!this.app) return;
      const confirmed = await confirmDelete(
        this.app,
        localeText(`确定删除子代理“${agent.name}”？`, `Delete subagent "${agent.name}"?`),
      );
      if (!confirmed) return;
      try {
        await this.storage.delete(agent);
        await this.render();
        await this.onChanged?.();
        new Notice(localeText(`子代理“${agent.name}”已删除`, `Subagent "${agent.name}" deleted`));
      } catch {
        new Notice(localeText('删除子代理失败', 'Failed to delete subagent'));
      }
      })();
    });
  }

  private openModal(existing: OpencodeAgentDefinition | null): void {
    if (!this.app) return;

    const modal = new OpencodeAgentModal(
      this.app,
      existing,
      this.agents,
      async (agent) => {
        await this.storage.save(agent, existing);
        await this.render();
        await this.onChanged?.();
        new Notice(
          existing
            ? localeText(`子代理“${agent.name}”已更新`, `Subagent "${agent.name}" updated`)
            : localeText(`子代理“${agent.name}”已创建`, `Subagent "${agent.name}" created`),
        );
      },
    );
    modal.open();
  }
}

function parseOptionalNumber(
  value: string,
  label: string,
): { error?: string; value?: number } {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { error: localeText(`${label} 必须是有效数字`, `${label} must be a valid number`) };
  }

  return { value: parsed };
}

function parseOptionalPositiveInteger(
  value: string,
  label: string,
): { error?: string; value?: number } {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: localeText(`${label} 必须是正整数`, `${label} must be a positive integer`) };
  }

  return { value: parsed };
}

function parseOptionalJson(
  value: string,
  label: string,
): { error?: string; value?: unknown } {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    return { error: localeText(`${label} 必须是有效 JSON`, `${label} must be valid JSON`) };
  }
}

function parseOptionalJsonObject(
  value: string,
  label: string,
): { error?: string; value?: Record<string, unknown> } {
  const parsed = parseOptionalJson(value, label);
  if (parsed.error || parsed.value === undefined) {
    return parsed.error ? { error: parsed.error } : {};
  }

  if (!isJsonObject(parsed.value)) {
    return { error: localeText(`${label} 必须是 JSON 对象`, `${label} must be a JSON object`) };
  }

  return { value: parsed.value };
}

function parseOptionalJsonObjectOfBooleans(
  value: string,
  label: string,
): { error?: string; value?: Record<string, boolean> } {
  const parsed = parseOptionalJsonObject(value, label);
  if (parsed.error || parsed.value === undefined) {
    return parsed.error ? { error: parsed.error } : {};
  }

  if (!Object.values(parsed.value).every((entry) => typeof entry === 'boolean')) {
    return { error: localeText(`${label} 必须将工具名称映射为布尔值`, `${label} must map tool names to boolean values`) };
  }

  return { value: parsed.value as Record<string, boolean> };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
