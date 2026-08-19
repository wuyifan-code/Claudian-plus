import path from 'node:path';

import { type App, Notice, setIcon, Setting } from 'obsidian';

import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from '../../core/providers/types';
import type { AgentSkillDiagnostic, AgentSkillDocument } from '../../core/skills/AgentSkill';
import { t } from '../../i18n/i18n';
import { localeText } from '../../i18n/i18n';
import type { TranslationKey } from '../../i18n/types';
import { FileViewerModal } from '../../shared/modals/FileViewerModal';
import { AgentSkillDeleteModal, AgentSkillModal } from '../../shared/settings/AgentSkillSettings';
import type { FeatureHost } from '../FeatureHost';
import type { AgentSkillManagementCoordinator } from './AgentSkillManagementCoordinator';
import {
  filterWorkspaceResourceRows,
  loadWorkspaceResources,
  SHARED_SKILL_ROW_KEY_PREFIX,
  type WorkspaceResourceRow,
  type WorkspaceResourceSection,
  type WorkspaceResourceStatus,
} from './workspaceResources';

const SECTIONS: readonly WorkspaceResourceSection[] = ['skills', 'agents', 'mcp', 'commands', 'memory', 'consciousness'];

const RESOURCE_SECTIONS = new Set<WorkspaceResourceSection>(['skills', 'agents', 'mcp', 'commands']);

const STATUS_COPY_KEYS: Record<WorkspaceResourceStatus, TranslationKey> = {
  available: 'settings.workspaceResources.status.available',
  connected: 'settings.workspaceResources.status.connected',
  disabled: 'settings.workspaceResources.status.disabled',
  readonly: 'settings.workspaceResources.status.readonly',
};

function sectionCopyKey(suffix: string): TranslationKey {
  return ('settings.workspaceResources.' + suffix) as TranslationKey;
}

export interface WorkspaceResourcesSettingsOptions {
  app: App;
  plugin: FeatureHost;
  coordinator: AgentSkillManagementCoordinator;
  /** Called after memory/consciousness settings change to restart services. */
  onSettingsChange?: () => void | Promise<void>;
}

/**
 * Aggregated cross-provider view of workspace resources (skills, subagents,
 * MCP servers, commands) rendered as second-level tabs inside the Workspace
 * settings tab. Only shared .agents/skills are editable here; the remaining
 * resources stay provider-managed and are shown read-only.
 */
export class WorkspaceResourcesSettings {
  private renderGeneration = 0;
  private activeSection: WorkspaceResourceSection = 'skills';
  private searchQuery = '';
  private providerIds: ProviderId[] = [];
  private readonly rowCache = new Map<WorkspaceResourceSection, WorkspaceResourceRow[]>();
  private sharedSkillDocs = new Map<string, AgentSkillDocument>();
  private skillDiagnostics: AgentSkillDiagnostic[] = [];

  private readonly rootEl: HTMLDivElement;
  private readonly subTabButtons = new Map<WorkspaceResourceSection, HTMLButtonElement>();
  private readonly searchInput: HTMLInputElement;
  private readonly createButton: HTMLButtonElement;
  private readonly contentEl: HTMLDivElement;
  private readonly unsubscribe: () => void;

  constructor(
    containerEl: HTMLElement,
    private readonly options: WorkspaceResourcesSettingsOptions,
  ) {
    this.rootEl = containerEl.createDiv({ cls: 'claudian-plus-wr-manager' });

    const subTabs = this.rootEl.createDiv({ cls: 'claudian-plus-wr-subtabs' });
    for (const section of SECTIONS) {
      const button = subTabs.createEl('button', {
        cls: 'claudian-plus-wr-subtab',
        text: t(sectionCopyKey('tabs.' + section)),
      });
      button.addEventListener('click', () => {
        if (this.activeSection === section) return;
        this.activeSection = section;
        void this.renderSection();
      });
      this.subTabButtons.set(section, button);
    }

    const toolbar = this.rootEl.createDiv({ cls: 'claudian-plus-wr-toolbar' });
    this.searchInput = toolbar.createEl('input', {
      cls: 'claudian-plus-wr-search',
      attr: {
        type: 'search',
        placeholder: t('settings.workspaceResources.searchPlaceholder'),
      },
    });
    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value;
      this.renderRows();
    });
    this.createButton = toolbar.createEl('button', {
      cls: 'claudian-plus-wr-create',
      text: t('settings.workspaceResources.create'),
    });
    this.createButton.addEventListener('click', () => this.openCreateModal());

    this.contentEl = this.rootEl.createDiv({ cls: 'claudian-plus-wr-content' });

    this.unsubscribe = options.coordinator.subscribe(() => {
      this.invalidateSection('skills');
    });

    void this.initialize();
  }

  dispose(): void {
    this.unsubscribe();
  }

  private async initialize(): Promise<void> {
    const generation = ++this.renderGeneration;
    this.updateChrome();
    this.renderLoading();

    this.providerIds = ProviderRegistry.getEnabledProviderIds(this.options.plugin.settings);
    await Promise.all(this.providerIds.map(async (providerId) => {
      try {
        await ProviderWorkspaceRegistry.ensureInitialized(
          this.options.plugin.providerHost,
          providerId,
          'settings-workspace-resources',
        );
      } catch {
        // A provider that fails to initialize contributes no rows.
      }
    }));
    if (generation !== this.renderGeneration) return;
    await this.renderSection();
  }

  private invalidateSection(section: WorkspaceResourceSection): void {
    this.rowCache.delete(section);
    if (this.activeSection === section) {
      void this.renderSection();
    }
  }

  private async renderSection(): Promise<void> {
    const generation = ++this.renderGeneration;
    this.updateChrome();

    // Memory and Consciousness are settings forms, not resource lists.
    if (this.activeSection === 'memory') {
      this.contentEl.empty();
      this.renderMemoryTab();
      return;
    }
    if (this.activeSection === 'consciousness') {
      this.contentEl.empty();
      this.renderConsciousnessTab();
      return;
    }

    let rows = this.rowCache.get(this.activeSection);
    if (!rows) {
      this.renderLoading();
      try {
        rows = await this.loadSectionRows(this.activeSection);
      } catch {
        if (generation !== this.renderGeneration) return;
        this.contentEl.empty();
        this.contentEl.createDiv({
          cls: 'claudian-plus-agent-skills-error',
          text: t('settings.workspaceResources.loadFailed'),
        });
        return;
      }
      if (generation !== this.renderGeneration) return;
      this.rowCache.set(this.activeSection, rows);
    }
    this.renderRows();
  }

  private async loadSectionRows(section: WorkspaceResourceSection): Promise<WorkspaceResourceRow[]> {
    if (section !== 'skills') {
      return loadWorkspaceResources(this.providerIds, section);
    }

    const skillResult = await this.options.coordinator.list();
    this.sharedSkillDocs = new Map(skillResult.skills.map(skill => [skill.name, skill]));
    this.skillDiagnostics = skillResult.diagnostics;
    const rows = await loadWorkspaceResources(this.providerIds, 'skills', {
      loadSharedSkills: async () => skillResult,
    });
    for (const row of rows) {
      if (!row.key.startsWith(SHARED_SKILL_ROW_KEY_PREFIX)) continue;
      const doc = this.sharedSkillDocs.get(row.name);
      if (doc) {
        row.status = doc.scope === 'home' ? 'readonly' : 'available';
      }
    }
    return rows;
  }

  private updateChrome(): void {
    for (const [section, button] of this.subTabButtons) {
      button.toggleClass('claudian-plus-wr-subtab--active', section === this.activeSection);
    }
    const isResourceTab = RESOURCE_SECTIONS.has(this.activeSection);
    this.searchInput.toggleClass('claudian-plus-wr-create--hidden', !isResourceTab);
    this.createButton.toggleClass('claudian-plus-wr-create--hidden', this.activeSection !== 'skills');
  }

  private renderLoading(): void {
    this.contentEl.empty();
    this.contentEl.createDiv({
      cls: 'claudian-plus-wr-loading',
      text: t('settings.workspaceResources.loading'),
    });
  }

  private renderRows(): void {
    const rows = this.rowCache.get(this.activeSection) ?? [];
    this.contentEl.empty();

    const filtered = filterWorkspaceResourceRows(rows, this.searchQuery);
    if (filtered.length === 0) {
      const query = this.searchQuery.trim();
      this.contentEl.createDiv({
        cls: 'claudian-plus-sp-empty-state',
        text: query
          ? t('settings.workspaceResources.noMatch', { query })
          : t(sectionCopyKey('empty.' + this.activeSection)),
      });
    } else {
      const list = this.contentEl.createDiv({ cls: 'claudian-plus-sp-list' });
      for (const row of filtered) {
        this.renderRow(list, row);
      }
    }

    if (this.activeSection === 'skills' && this.skillDiagnostics.length > 0) {
      this.renderDiagnostics();
    }
  }

  private renderRow(list: HTMLElement, row: WorkspaceResourceRow): void {
    const item = list.createDiv({ cls: 'claudian-plus-sp-item' });
    const info = item.createDiv({ cls: 'claudian-plus-sp-info' });
    const header = info.createDiv({ cls: 'claudian-plus-sp-item-header' });
    header.createSpan({ cls: 'claudian-plus-sp-item-name', text: row.name });

    for (const providerId of row.providerIds) {
      header.createSpan({
        cls: 'claudian-plus-slash-item-badge',
        text: ProviderRegistry.getProviderDisplayName(providerId),
      });
    }

    const sharedDoc = this.resolveSharedSkillDoc(row);
    if (sharedDoc) {
      const scope = sharedDoc.scope ?? 'vault';
      header.createSpan({
        cls: 'claudian-plus-slash-item-badge claudian-plus-sp-scope-badge claudian-plus-sp-scope-badge--' + scope,
        text: scope === 'home' ? 'home' : 'vault',
      });
    }

    header.createSpan({
      cls: 'claudian-plus-slash-item-badge claudian-plus-wr-status claudian-plus-wr-status--' + row.status,
      text: t(STATUS_COPY_KEYS[row.status]),
    });

    if (row.description) {
      info.createDiv({ cls: 'claudian-plus-sp-item-desc', text: row.description });
    }
    info.createDiv({ cls: 'claudian-plus-wr-item-source', text: row.source });

    if (sharedDoc && sharedDoc.scope !== 'home') {
      this.renderSkillActions(item, sharedDoc);
    }
  }

  private resolveSharedSkillDoc(row: WorkspaceResourceRow): AgentSkillDocument | null {
    if (this.activeSection !== 'skills') return null;
    if (!row.key.startsWith(SHARED_SKILL_ROW_KEY_PREFIX)) return null;
    return this.sharedSkillDocs.get(row.name) ?? null;
  }

  private renderSkillActions(item: HTMLElement, doc: AgentSkillDocument): void {
    const actions = item.createDiv({ cls: 'claudian-plus-sp-item-actions' });
    const editButton = actions.createEl('button', {
      cls: 'claudian-plus-settings-action-btn',
      attr: { 'aria-label': t('common.edit') },
    });
    setIcon(editButton, 'pencil');
    editButton.addEventListener('click', () => {
      const modal = new AgentSkillModal(this.options.app, doc, input => (
        this.options.coordinator.update(doc.name, doc.revision, input)
      ));
      modal.open();
    });
    const deleteButton = actions.createEl('button', {
      cls: 'claudian-plus-settings-action-btn claudian-plus-settings-delete-btn',
      attr: { 'aria-label': t('common.delete') },
    });
    setIcon(deleteButton, 'trash-2');
    deleteButton.addEventListener('click', () => {
      const modal = new AgentSkillDeleteModal(this.options.app, doc, () => (
        this.options.coordinator.trash(doc.name, doc.revision)
      ));
      modal.open();
    });
  }

  private renderDiagnostics(): void {
    const diagnostics = this.contentEl.createDiv({ cls: 'claudian-plus-agent-skills-diagnostics' });
    diagnostics.createDiv({
      cls: 'claudian-plus-agent-skills-diagnostics-title',
      text: t('settings.agentSkills.diagnosticsTitle'),
    });
    for (const diagnostic of this.skillDiagnostics) {
      const item = diagnostics.createDiv({ cls: 'claudian-plus-agent-skills-diagnostic' });
      item.createEl('code', { text: diagnostic.directoryPath });
      item.createSpan({ text: diagnostic.message });
    }
  }

  private openCreateModal(): void {
    if (this.activeSection !== 'skills') return;
    const modal = new AgentSkillModal(this.options.app, null, input => (
      this.options.coordinator.create(input)
    ));
    modal.open();
  }

  // ---------------------------------------------------------------------------
  // Memory sub-tab
  // ---------------------------------------------------------------------------

  private renderMemoryTab(): void {
    const { plugin, app } = this.options;
    const card = this.contentEl.createDiv({ cls: 'claudian-plus-settings-card' });

    new Setting(card)
      .setName(t('settings.memory.enabled.name'))
      .setDesc(t('settings.memory.enabled.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(plugin.settings.memoryEnabled ?? true)
          .onChange(async (value) => {
            await plugin.mutateSettings((settings) => {
              settings.memoryEnabled = value;
            });
            void this.options.onSettingsChange?.();
            this.contentEl.empty();
            this.renderMemoryTab();
          });
      });

    if (plugin.settings.memoryEnabled ?? true) {
      new Setting(card)
        .setName(t('settings.memory.filePath.name'))
        .setDesc(t('settings.memory.filePath.desc'))
        .addText((text) => {
          text
            .setPlaceholder('.claudian-plus/memory.md')
            .setValue(plugin.settings.memoryFilePath)
            .onChange(async (value) => {
              await plugin.mutateSettings((settings) => {
                settings.memoryFilePath = value.trim() || '.claudian-plus/memory.md';
              });
            });
          text.inputEl.addEventListener('blur', () => {
            void this.options.onSettingsChange?.();
          });
        });

      new Setting(card)
        .setName(t('settings.memory.maxChars.name'))
        .setDesc(t('settings.memory.maxChars.desc'))
        .addSlider((slider) => {
          slider
            .setLimits(500, 5000, 100)
            .setValue(plugin.settings.memoryMaxInjectionChars ?? 1500)
            .setDynamicTooltip()
            .onChange(async (value) => {
              await plugin.mutateSettings((settings) => {
                settings.memoryMaxInjectionChars = value;
              });
            });
        });

      const memoryButtonSetting = new Setting(card)
        .setName(t('settings.memory.manage.name'))
        .setDesc(t('settings.memory.manage.desc'));

      memoryButtonSetting.addButton((button) => {
        button
          .setButtonText(t('settings.memory.viewBtn'))
          .setCta()
          .onClick(async () => {
            const vaultPath = (app.vault.adapter as { basePath?: string }).basePath || '';
            const memoryPath = plugin.settings.memoryFilePath || '.claudian-plus/memory.md';
            const absolutePath = path.isAbsolute(memoryPath)
              ? memoryPath
              : path.join(vaultPath, memoryPath);

            new FileViewerModal(app, localeText('记忆与沉淀文件', 'Memory files'), [
              { label: localeText('长期记忆 (memory.md)', 'Long-term memory (memory.md)'), path: absolutePath },
            ]).open();
          });
      });

      memoryButtonSetting.addButton((button) => {
        button
          .setButtonText(t('settings.memory.clearBtn'))
          .setWarning()
          .onClick(async () => {
            const memoryStore = plugin.getMemoryStore();
            const entries = await memoryStore.load();
            if (entries.length === 0) {
              new Notice(t('settings.memory.alreadyEmpty'));
              return;
            }
            await memoryStore.save([]);
            new Notice(t('settings.memory.cleared'));
            void this.options.onSettingsChange?.();
          });
      });

      const memoryStatusSetting = new Setting(card)
        .setName(localeText('记忆文件状态', 'Memory file status'))
        .setDesc(localeText('读取中…', 'Loading…'));
      void (async () => {
        try {
          const store = plugin.getMemoryStore();
          const entries = await store.load();
          memoryStatusSetting.setDesc(localeText(
            `路径：${store.filePath}，共 ${entries.length} 条。每次写入前自动备份到 .claudian-plus/backups/（保留 20 份）。`,
            `Path: ${store.filePath}, ${entries.length} entrie(s). A backup is kept in .claudian-plus/backups/ before every write (20 retained).`,
          ));
        } catch {
          memoryStatusSetting.setDesc(localeText('读取失败', 'Failed to load memory status'));
        }
      })();
    }
  }

  // ---------------------------------------------------------------------------
  // Consciousness sub-tab
  // ---------------------------------------------------------------------------

  private renderConsciousnessTab(): void {
    const { plugin, app } = this.options;
    const card = this.contentEl.createDiv({ cls: 'claudian-plus-settings-card' });

    new Setting(card)
      .setName(t('settings.consciousness.enabled.name'))
      .setDesc(t('settings.consciousness.enabled.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(plugin.settings.consciousnessEnabled ?? false)
          .onChange(async (value) => {
            await plugin.mutateSettings((settings) => {
              settings.consciousnessEnabled = value;
            });
            const engine = plugin.getConsciousnessEngine();
            engine.updateConfig({
              enabled: value,
              autoMemoryEnabled: plugin.settings.consciousnessAutoMemory,
            });
            if (value) {
              await engine.initialize();
            }
            void this.options.onSettingsChange?.();
            this.contentEl.empty();
            this.renderConsciousnessTab();
          });
      });

    if (plugin.settings.consciousnessEnabled ?? false) {
      new Setting(card)
        .setName(t('settings.consciousness.autoMemory.name'))
        .setDesc(t('settings.consciousness.autoMemory.desc'))
        .addToggle((toggle) => {
          toggle
            .setValue(plugin.settings.consciousnessAutoMemory ?? false)
            .onChange(async (value) => {
              await plugin.mutateSettings((settings) => {
                settings.consciousnessAutoMemory = value;
              });
              plugin.getConsciousnessEngine().updateConfig({ autoMemoryEnabled: value });
            });
        });

      if (plugin.settings.consciousnessAutoMemory ?? false) {
        const dreamHeading = card.createDiv({
          cls: 'claudian-plus-settings-subheading',
          text: t('settings.dream.heading'),
        });
        dreamHeading.createDiv({
          cls: 'claudian-plus-settings-feature-guide-copy',
          text: t('settings.dream.desc'),
        });

        const hours = Math.max(1, Math.round((plugin.settings.dreamIntervalMs ?? 24 * 60 * 60 * 1000) / (60 * 60 * 1000)));
        new Setting(card)
          .setName(t('settings.dream.interval.name'))
          .setDesc(t('settings.dream.interval.desc'))
          .addText((text) => text
            .setValue(String(hours))
            .onChange(async (value) => {
              const parsed = Math.max(1, Number.parseInt(value, 10) || 24);
              await plugin.mutateSettings((settings) => {
                settings.dreamIntervalMs = parsed * 60 * 60 * 1000;
              });
            }));

        new Setting(card)
          .setName(t('settings.dream.maxLogDays.name'))
          .setDesc(t('settings.dream.maxLogDays.desc'))
          .addText((text) => text
            .setValue(String(plugin.settings.dreamMaxLogDays ?? 7))
            .onChange(async (value) => {
              const parsed = Math.max(1, Number.parseInt(value, 10) || 7);
              await plugin.mutateSettings((settings) => {
                settings.dreamMaxLogDays = parsed;
              });
            }));

        new Setting(card)
          .setName(t('settings.dream.inputCap.name'))
          .setDesc(t('settings.dream.inputCap.desc'))
          .addText((text) => text
            .setValue(String(plugin.settings.dreamInputCharCap ?? 8000))
            .onChange(async (value) => {
              const parsed = Math.max(1000, Number.parseInt(value, 10) || 8000);
              await plugin.mutateSettings((settings) => {
                settings.dreamInputCharCap = parsed;
              });
            }));

        new Setting(card)
          .setName(t('settings.dream.maxNewFacts.name'))
          .setDesc(t('settings.dream.maxNewFacts.desc'))
          .addText((text) => text
            .setValue(String(plugin.settings.dreamMaxNewFacts ?? 10))
            .onChange(async (value) => {
              const parsed = Math.max(1, Number.parseInt(value, 10) || 10);
              await plugin.mutateSettings((settings) => {
                settings.dreamMaxNewFacts = parsed;
              });
            }));

        new Setting(card)
          .setName(t('settings.dream.runNow'))
          .setDesc(t('settings.dream.runNowDesc'))
          .addButton((button) => {
            button
              .setButtonText(t('settings.dream.runNow'))
              .setCta()
              .onClick(async () => {
                const result = await plugin.getDreamService().runDream(true);
                if (result.ran) {
                  new Notice(`Dream memory consolidated: ${result.newFacts} fact(s), ${result.profileUpdates} profile update(s).`);
                } else if (result.reason === 'no-new-logs') {
                  new Notice('No new short-term memories to consolidate.');
                } else if (result.reason === 'already-running') {
                  new Notice('A memory consolidation is already running.');
                } else if (result.reason === 'failed') {
                  new Notice(`Memory consolidation failed: ${result.error ?? 'unknown error'}`);
                }
              });
          });
      }

      const consciousnessButtonSetting = new Setting(card)
        .setName(t('settings.consciousness.viewBtn'))
        .setDesc('.claudian-plus/awareness/');

      consciousnessButtonSetting.addButton((button) => {
        button
          .setButtonText(t('settings.consciousness.viewBtn'))
          .setCta()
          .onClick(async () => {
            const engine = plugin.getConsciousnessEngine();
            await engine.initialize();

            const vaultPath = (app.vault.adapter as { basePath?: string }).basePath || '';
            const soulPath = path.join(vaultPath, '.claudian-plus', 'awareness', 'SOUL.md');
            const userPath = path.join(vaultPath, '.claudian-plus', 'awareness', 'USER.md');
            const activityPath = path.join(vaultPath, '.claudian-plus', 'awareness', 'activity.json');

            new FileViewerModal(app, localeText('意识网络文件 (Awareness Network)', 'Awareness Network files'), [
              { label: localeText('用户画像 (USER.md)', 'User profile (USER.md)'), path: userPath },
              { label: localeText('协作风格 (SOUL.md)', 'Collaboration style (SOUL.md)'), path: soulPath },
              { label: localeText('活动记录 (activity.json)', 'Activity log (activity.json)'), path: activityPath },
            ]).open();
          });
      });

      consciousnessButtonSetting.addButton((button) => {
        button
          .setButtonText(t('settings.consciousness.clearBtn'))
          .setWarning()
          .onClick(async () => {
            const engine = plugin.getConsciousnessEngine();
            await plugin.getMemoryStore().save([]);
            await engine.clearAll(plugin.settings.memoryFilePath, {
              clearMemoryFile: false,
            });
            await plugin.getVaultKnowledgeEngine().clearIndex();
            new Notice('Consciousness data reset');
          });
      });
    }
  }
}
