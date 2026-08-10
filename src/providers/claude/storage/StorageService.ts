import type { App } from 'obsidian';

import { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { AgentVaultStorage } from './AgentVaultStorage';
import { CCSettingsStorage } from './CCSettingsStorage';
import { McpStorage } from './McpStorage';
import { SkillStorage } from './SkillStorage';
import { SlashCommandStorage } from './SlashCommandStorage';

interface StorageServicePlugin {
  readonly app: App;
}

export class StorageService {
  readonly ccSettings: CCSettingsStorage;
  readonly commands: SlashCommandStorage;
  readonly skills: SkillStorage;
  readonly mcp: McpStorage;
  readonly agents: AgentVaultStorage;

  constructor(plugin: StorageServicePlugin, adapter?: VaultFileAdapter) {
    const vaultAdapter = adapter ?? new VaultFileAdapter(plugin.app);
    this.ccSettings = new CCSettingsStorage(vaultAdapter);
    this.commands = new SlashCommandStorage(vaultAdapter);
    this.skills = new SkillStorage(vaultAdapter);
    this.mcp = new McpStorage(vaultAdapter);
    this.agents = new AgentVaultStorage(vaultAdapter);
  }
}
