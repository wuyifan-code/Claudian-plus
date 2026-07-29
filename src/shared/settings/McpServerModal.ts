import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import type {
  ManagedMcpServer,
  McpHttpServerConfig,
  McpServerConfig,
  McpServerType,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../core/types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from '../../core/types';
import { localeText } from '../../i18n/i18n';
import { parseCommand } from '../../utils/mcp';

export class McpServerModal extends Modal {
  private existingServer: ManagedMcpServer | null;
  private onSave: (server: ManagedMcpServer) => void;

  private serverName = '';
  private serverType: McpServerType = 'stdio';
  private enabled = DEFAULT_MCP_SERVER.enabled;
  private contextSaving = DEFAULT_MCP_SERVER.contextSaving;
  private command = '';
  private env = '';
  private url = '';
  private headers = '';
  private typeFieldsEl: HTMLElement | null = null;
  private nameInputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    existingServer: ManagedMcpServer | null,
    onSave: (server: ManagedMcpServer) => void,
    initialType?: McpServerType,
    prefillConfig?: { name: string; config: McpServerConfig }
  ) {
    super(app);
    this.existingServer = existingServer;
    this.onSave = onSave;

    if (existingServer) {
      this.serverName = existingServer.name;
      this.serverType = getMcpServerType(existingServer.config);
      this.enabled = existingServer.enabled;
      this.contextSaving = existingServer.contextSaving;
      this.initFromConfig(existingServer.config);
    } else if (prefillConfig) {
      this.serverName = prefillConfig.name;
      this.serverType = getMcpServerType(prefillConfig.config);
      this.initFromConfig(prefillConfig.config);
    } else if (initialType) {
      this.serverType = initialType;
    }
  }

  private initFromConfig(config: McpServerConfig) {
    const type = getMcpServerType(config);
    if (type === 'stdio') {
      const stdioConfig = config as McpStdioServerConfig;
      if (stdioConfig.args && stdioConfig.args.length > 0) {
        this.command = stdioConfig.command + ' ' + stdioConfig.args.join(' ');
      } else {
        this.command = stdioConfig.command;
      }
      this.env = this.envRecordToString(stdioConfig.env);
    } else {
      const urlConfig = config as McpSSEServerConfig | McpHttpServerConfig;
      this.url = urlConfig.url;
      this.headers = this.envRecordToString(urlConfig.headers);
    }
  }

  onOpen() {
    this.setTitle(this.existingServer ? localeText('编辑 MCP 服务器', 'Edit MCP Server') : localeText('添加 MCP 服务器', 'Add MCP Server'));
    this.modalEl.addClass('claudian-plus-mcp-modal');

    const { contentEl } = this;

    new Setting(contentEl)
      .setName(localeText('服务器名称', 'Server name'))
      .setDesc(localeText('此服务器的唯一标识符', 'Unique identifier for this server'))
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text.setValue(this.serverName);
        text.setPlaceholder('My-mcp-server');
        text.onChange((value) => {
          this.serverName = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    new Setting(contentEl)
      .setName(localeText('类型', 'Type'))
      .setDesc(localeText('服务器连接类型', 'Server connection type'))
      .addDropdown((dropdown) => {
        dropdown.addOption('stdio', localeText('Stdio（本地命令）', 'Stdio (local command)'));
        dropdown.addOption('sse', localeText('SSE（服务器推送事件）', 'Sse (server-sent events)'));
        dropdown.addOption('http', localeText('HTTP（HTTP 端点）', 'HTTP (HTTP endpoint)'));
        dropdown.setValue(this.serverType);
        dropdown.onChange((value) => {
          this.serverType = value as McpServerType;
          this.renderTypeFields();
        });
      });

    this.typeFieldsEl = contentEl.createDiv({ cls: 'claudian-plus-mcp-type-fields' });
    this.renderTypeFields();

    new Setting(contentEl)
      .setName(localeText('启用', 'Enabled'))
      .setDesc(localeText('是否启用此服务器', 'Whether this server is active'))
      .addToggle((toggle) => {
        toggle.setValue(this.enabled);
        toggle.onChange((value) => {
          this.enabled = value;
        });
      });

    new Setting(contentEl)
      .setName(localeText('节省上下文模式', 'Context-saving mode'))
      .setDesc(localeText('除非通过 @ 提及，否则不向代理显示工具（节省上下文窗口）', 'Hide tools from agent unless @-mentioned (saves context window)'))
      .addToggle((toggle) => {
        toggle.setValue(this.contextSaving);
        toggle.onChange((value) => {
          this.contextSaving = value;
        });
      });

    const buttonContainer = contentEl.createDiv({ cls: 'claudian-plus-mcp-buttons' });

    const cancelBtn = buttonContainer.createEl('button', {
      text: localeText('取消', 'Cancel'),
      cls: 'claudian-plus-cancel-btn',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: this.existingServer ? localeText('更新', 'Update') : localeText('添加', 'Add'),
      cls: 'claudian-plus-save-btn mod-cta',
    });
    saveBtn.addEventListener('click', () => this.save());
  }

  private renderTypeFields() {
    if (!this.typeFieldsEl) return;
    this.typeFieldsEl.empty();

    if (this.serverType === 'stdio') {
      this.renderStdioFields();
    } else {
      this.renderUrlFields();
    }
  }

  private renderStdioFields() {
    if (!this.typeFieldsEl) return;

    const cmdSetting = new Setting(this.typeFieldsEl)
      .setName(localeText('命令', 'Command'))
      .setDesc(localeText('包含参数的完整命令', 'Full command with arguments'));
    cmdSetting.settingEl.addClass('claudian-plus-mcp-cmd-setting');

    const cmdTextarea = cmdSetting.controlEl.createEl('textarea', {
      cls: 'claudian-plus-mcp-cmd-textarea',
    });
    cmdTextarea.value = this.command;
    cmdTextarea.placeholder = 'Docker exec -i mcp-server python -m src.server';
    cmdTextarea.rows = 2;
    cmdTextarea.addEventListener('input', () => {
      this.command = cmdTextarea.value;
    });

    const envSetting = new Setting(this.typeFieldsEl)
      .setName(localeText('环境变量', 'Environment variables'))
      .setDesc(localeText('每行一个 Key=value（可选）', 'Key=value per line (optional)'));
    envSetting.settingEl.addClass('claudian-plus-mcp-env-setting');

    const envTextarea = envSetting.controlEl.createEl('textarea', {
      cls: 'claudian-plus-mcp-env-textarea',
    });
    envTextarea.value = this.env;
    envTextarea.placeholder = 'API_key=your-key';
    envTextarea.rows = 2;
    envTextarea.addEventListener('input', () => {
      this.env = envTextarea.value;
    });
  }

  private renderUrlFields() {
    if (!this.typeFieldsEl) return;

    new Setting(this.typeFieldsEl)
      .setName('URL')
      .setDesc(this.serverType === 'sse' ? localeText('SSE 端点 URL', 'SSE endpoint URL') : localeText('HTTP 端点 URL', 'HTTP endpoint URL'))
      .addText((text) => {
        text.setValue(this.url);
        text.setPlaceholder('HTTP://localhost:3000/sse');
        text.onChange((value) => {
          this.url = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    const headersSetting = new Setting(this.typeFieldsEl)
      .setName(localeText('请求头', 'Headers'))
      .setDesc(localeText('HTTP 请求头（每行一个 key=value）', 'HTTP headers (key=value per line)'));
    headersSetting.settingEl.addClass('claudian-plus-mcp-env-setting');

    const headersTextarea = headersSetting.controlEl.createEl('textarea', {
      cls: 'claudian-plus-mcp-env-textarea',
    });
    headersTextarea.value = this.headers;
    headersTextarea.placeholder = 'Authorization=bearer token\ncontent-type=application/JSON';
    headersTextarea.rows = 3;
    headersTextarea.addEventListener('input', () => {
      this.headers = headersTextarea.value;
    });
  }

  private handleKeyDown(e: KeyboardEvent) {
    // !e.isComposing for IME support
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.save();
    } else if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      this.close();
    }
  }

  private save() {
    const name = this.serverName.trim();
    if (!name) {
      new Notice(localeText('请输入服务器名称', 'Please enter a server name'));
      this.nameInputEl?.focus();
      return;
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      new Notice(localeText('服务器名称只能包含字母、数字、点、连字符和下划线', 'Server name can only contain letters, numbers, dots, hyphens, and underscores'));
      this.nameInputEl?.focus();
      return;
    }

    let config: McpServerConfig;

    if (this.serverType === 'stdio') {
      const fullCommand = this.command.trim();
      if (!fullCommand) {
        new Notice(localeText('请输入命令', 'Please enter a command'));
        return;
      }

      const { cmd, args } = parseCommand(fullCommand);
      const stdioConfig: McpStdioServerConfig = { command: cmd };

      if (args.length > 0) {
        stdioConfig.args = args;
      }

      const env = this.parseEnvString(this.env);
      if (Object.keys(env).length > 0) {
        stdioConfig.env = env;
      }

      config = stdioConfig;
    } else {
      const url = this.url.trim();
      if (!url) {
        new Notice(localeText('请输入 URL', 'Please enter a URL'));
        return;
      }

      if (this.serverType === 'sse') {
        const sseConfig: McpSSEServerConfig = { type: 'sse', url };
        const headers = this.parseEnvString(this.headers);
        if (Object.keys(headers).length > 0) {
          sseConfig.headers = headers;
        }
        config = sseConfig;
      } else {
        const httpConfig: McpHttpServerConfig = { type: 'http', url };
        const headers = this.parseEnvString(this.headers);
        if (Object.keys(headers).length > 0) {
          httpConfig.headers = headers;
        }
        config = httpConfig;
      }
    }

    const server: ManagedMcpServer = {
      name,
      config,
      enabled: this.enabled,
      contextSaving: this.contextSaving,
      disabledTools: this.existingServer?.disabledTools,
    };

    this.onSave(server);
    this.close();
  }

  private parseEnvString(envStr: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!envStr.trim()) return result;

    for (const line of envStr.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();

      if (key) {
        result[key] = value;
      }
    }

    return result;
  }

  private envRecordToString(env: Record<string, string> | undefined): string {
    if (!env) return '';
    return Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }

  onClose() {
    this.contentEl.empty();
  }
}
