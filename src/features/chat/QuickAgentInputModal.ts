import { type App,Modal, Notice, Setting } from 'obsidian';

import { localeText } from '../../i18n/i18n';

/**
 * A lightweight floating modal for quick agent queries.
 * Opens on a hotkey; type a prompt → Enter to send to the chat sidebar.
 */
export class QuickAgentInputModal extends Modal {
  private promptValue = '';

  constructor(
    app: App,
    private readonly onSubmit: (prompt: string) => Promise<void>,
    private readonly placeholder?: string,
  ) {
    super(app);
    this.setTitle(localeText('快速 Agent 输入', 'Quick Agent Input'));
    this.scope.register(['Mod'], 'Enter', () => {
      this.submit();
      return false;
    });
    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl('p', {
      text: localeText(
        '在下方输入提示词。按 Mod+Enter 发送，按 Esc 取消。',
        'Enter your prompt below. Mod+Enter to send, Esc to cancel.',
      ),
      cls: 'claudian-plus-quick-input-hint',
    });

    new Setting(contentEl)
      .setName(localeText('提示词', 'Prompt'))
      .setDesc(localeText(
        '询问 Agent 任意问题——自动引用 Vault 上下文',
        'Ask the agent anything — references vault context automatically',
      ))
      .addTextArea((textarea) => {
        textarea
          .setPlaceholder(this.placeholder ?? localeText(
            '例如：总结我最近关于 Rust 的笔记…',
            'e.g. Summarize my recent notes on Rust...',
          ))
          .onChange((value) => { this.promptValue = value; });
        textarea.inputEl.rows = 5;
        textarea.inputEl.addClass('claudian-plus-quick-input-textarea');

        // Focus and select all on open
        window.setTimeout(() => {
          textarea.inputEl.focus();
          textarea.inputEl.select();
        }, 50);
      });

    contentEl.createDiv({ cls: 'claudian-plus-quick-input-actions' }, (el) => {
      const sendBtn = el.createEl('button', {
        text: localeText('发送', 'Send'),
        cls: 'mod-cta',
      });
      sendBtn.addEventListener('click', () => { void this.submit(); });

      const cancelBtn = el.createEl('button', {
        text: localeText('取消', 'Cancel'),
      });
      cancelBtn.addEventListener('click', () => this.close());
    });
  }

  private async submit(): Promise<void> {
    const trimmed = this.promptValue.trim();
    if (!trimmed) {
      new Notice(localeText('提示词不能为空。', 'Prompt cannot be empty.'));
      return;
    }
    this.close();
    await this.onSubmit(trimmed);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
