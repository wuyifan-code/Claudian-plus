import { Setting } from 'obsidian';

import type { ProviderSettingsTabRendererContext } from '../../../core/providers/types';
import { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { getMcpServerType } from '../../../core/types';
import { localeText } from '../../../i18n/i18n';
import { DshAgentStorage } from '../agents/DshAgentStorage';
import { DshMcpServerManager } from '../app/DshMcpServerManager';
import { DshCommandCatalog } from '../commands/DshCommandCatalog';

/**
 * Discovery sections rendered inside the DeepSeek settings tab: the skills
 * DSH can load (vault + home roots), the agents mentionable in chat, and the
 * MCP servers mapped into the DSH launch overlay.
 */
export async function renderDshDiscoverySections(
  container: HTMLElement,
  context: ProviderSettingsTabRendererContext,
): Promise<void> {
  const adapter = new VaultFileAdapter(context.plugin.app);
  const homeAdapter = new HomeFileAdapter();

  new Setting(container).setName(localeText('发现', 'Discovery')).setHeading();

  await renderSkillSection(container, adapter);
  await renderAgentSection(container, adapter, homeAdapter);
  await renderMcpSection(container, adapter);
}

async function renderSkillSection(
  container: HTMLElement,
  adapter: VaultFileAdapter,
): Promise<void> {
  const heading = new Setting(container)
    .setName(localeText('技能', 'Skills'))
    .setDesc(localeText(
      'DSH 会话中可加载的技能（SKILL.md，来自 vault 与 home 的 .claude/.codex/.agents 根）。只读，文件与其他工具共享。',
      'Skills loadable in DSH sessions (SKILL.md from vault and home .claude/.codex/.agents roots). Read-only; files are shared with other tooling.',
    ));

  const catalog = new DshCommandCatalog(adapter);
  const entries = await catalog.listVaultEntries();
  const skills = entries.filter((entry) => entry.kind === 'skill');
  if (skills.length === 0) {
    heading.setDesc(heading.descEl.textContent ?? '');
    renderEmpty(container, localeText('未发现技能', 'No skills found'));
    return;
  }

  for (const skill of skills) {
    new Setting(container)
      .setName(`/${skill.name}`)
      .setDesc(skill.description ?? 'SKILL.md');
  }
}

async function renderAgentSection(
  container: HTMLElement,
  adapter: VaultFileAdapter,
  homeAdapter: HomeFileAdapter,
): Promise<void> {
  new Setting(container)
    .setName(localeText('代理', 'Agents'))
    .setDesc(localeText(
      '可在聊天中用 @ 提及的代理（vault 与 home 的 .claude/agents 与 .codex/agents）。提及会把代理定义注入提示词。',
      'Agents mentionable in chat (@-mention; vault and home .claude/agents and .codex/agents). Mentions inject the agent definition into the prompt.',
    ));

  const storage = new DshAgentStorage(adapter, homeAdapter);
  const agents = await storage.loadAll();
  if (agents.length === 0) {
    renderEmpty(container, localeText('未发现代理', 'No agents found'));
    return;
  }

  for (const agent of agents) {
    new Setting(container)
      .setName(`@${agent.name}`)
      .setDesc(agent.description);
  }
}

async function renderMcpSection(
  container: HTMLElement,
  adapter: VaultFileAdapter,
): Promise<void> {
  new Setting(container)
    .setName(localeText('MCP 服务器', 'MCP servers'))
    .setDesc(localeText(
      '从 .claude/mcp.json 读取。启用的服务器会作为 dsh-mcp-client 注入 DSH 启动 overlay（stdio/HTTP；SSE 不支持）。',
      'Read from .claude/mcp.json. Enabled servers are injected into the DSH launch overlay as dsh-mcp-client rows (stdio/HTTP; SSE unsupported).',
    ));

  const manager = new DshMcpServerManager(adapter);
  await manager.ensureLoaded();
  const servers = manager.getServers();
  if (servers.length === 0) {
    renderEmpty(container, localeText('未配置 MCP 服务器', 'No MCP servers configured'));
    return;
  }

  for (const server of servers) {
    const type = getMcpServerType(server.config);
    new Setting(container)
      .setName(server.name)
      .setDesc(
        server.enabled
          ? localeText(`${type} · 已启用（注入 DSH overlay）`, `${type} · enabled (injected into the DSH overlay)`)
          : localeText(`${type} · 已禁用`, `${type} · disabled`),
      );
  }
}

function renderEmpty(container: HTMLElement, text: string): void {
  container.createDiv({
    cls: 'claudian-plus-settings-desc',
    text,
  });
}
