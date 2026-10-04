import { Notice } from 'obsidian';

import type { DurableMindEntry, MindCategory, StagingMindEntry } from '../../core/memory/mind-types';
import type { MindStore } from '../../core/memory/MindStore';
import type { MemoryCoordinator } from '../../core/memory/v2/MemoryCoordinator';
import type { MemoryRepository } from '../../core/memory/v2/MemoryRepository';
import type { MemoryRecord } from '../../core/memory/v2/types';

export interface MindSettingsTabOptions {
  containerEl: HTMLElement;
  mindStore: MindStore;
  memoryRepository?: MemoryRepository;
  memoryCoordinator?: MemoryCoordinator;
  locale?: string;
  onChanged?: () => void;
}

function categoryLabel(cat: MindCategory, isZh: boolean): string {
  switch (cat) {
    case 'user_preference':
      return isZh ? '用户偏好' : 'User Preference';
    case 'coding_habit':
      return isZh ? '编码习惯' : 'Coding Habit';
    case 'project_rule':
      return isZh ? '项目规则' : 'Project Rule';
    case 'correction_rule':
      return isZh ? '纠偏经验' : 'Correction Rule';
  }
}

export class MindSettingsTab {
  private readonly containerEl: HTMLElement;
  private readonly mindStore: MindStore;
  private readonly memoryRepository?: MemoryRepository;
  private readonly memoryCoordinator?: MemoryCoordinator;
  private readonly isZh: boolean;
  private readonly onChanged?: () => void;

  private selectedScopeFilter: 'all' | 'global' | 'project' = 'all';
  private searchQuery = '';
  private v2SearchQuery = '';

  constructor(options: MindSettingsTabOptions) {
    this.containerEl = options.containerEl;
    this.mindStore = options.mindStore;
    this.memoryRepository = options.memoryRepository;
    this.memoryCoordinator = options.memoryCoordinator;
    this.isZh = (options.locale ?? 'en').toLowerCase().startsWith('zh');
    this.onChanged = options.onChanged;
  }

  async render(): Promise<void> {
    this.containerEl.empty();
    const root = this.containerEl.createDiv({ cls: 'claudian-plus-mind-settings' });

    const stagingEntries = await this.mindStore.listStaging();
    const durableEntries = await this.mindStore.listDurable();

    this.renderHeader(root);
    this.renderStagingSection(root, stagingEntries);
    this.renderDurableSection(root, durableEntries);

    if (this.memoryRepository) {
      await this.renderV2Section(root);
    }
  }

  private renderHeader(root: HTMLElement): void {
    const card = root.createDiv({ cls: 'claudian-plus-settings-card' });
    const header = card.createDiv({
      cls: 'claudian-plus-settings-card-header',
      text: this.isZh ? 'AI 心智与微梦境 (Dreaming V3)' : 'AI Mind & Habits (Dreaming V3)',
    });
    header.createDiv({
      cls: 'claudian-plus-settings-feature-guide-copy',
      text: this.isZh
        ? '会话驱动的时态感知心智演进引擎。AI 在每次会话结束时自动提炼高确定性偏好与项目规则，经你确认后精准注入后续对话。'
        : 'Session-driven temporal mind engine. Automatically synthesizes durable habits and project rules from conversations with user review.',
    });
  }

  private renderStagingSection(root: HTMLElement, stagingList: StagingMindEntry[]): void {
    const card = root.createDiv({ cls: 'claudian-plus-settings-card' });
    const headerRow = card.createDiv({ cls: 'claudian-plus-mind-section-header' });

    headerRow.createDiv({
      cls: 'claudian-plus-settings-card-header',
      text: this.isZh ? `待审草稿箱 (${stagingList.length})` : `Staging Queue (${stagingList.length})`,
    });

    if (stagingList.length > 0) {
      const actionsEl = headerRow.createDiv({ cls: 'claudian-plus-mind-header-actions' });
      const approveAllBtn = actionsEl.createEl('button', {
        cls: 'mod-cta',
        text: this.isZh ? '全部采纳' : 'Approve All',
      });
      approveAllBtn.addEventListener('click', () => {
        void (async () => {
          await this.mindStore.approveAllStaging();
          this.onChanged?.();
          await this.render();
        })();
      });

      const clearBtn = actionsEl.createEl('button', {
        text: this.isZh ? '清空草稿' : 'Clear All',
      });
      clearBtn.addEventListener('click', () => {
        void (async () => {
          await this.mindStore.clearStaging();
          this.onChanged?.();
          await this.render();
        })();
      });
    }

    if (stagingList.length === 0) {
      card.createDiv({
        cls: 'claudian-plus-mind-empty-hint',
        text: this.isZh
          ? '暂无待审草稿。当长会话结束或产生实质代码交互时，微梦境将自动在此生成心智建议。'
          : 'No pending staging entries. When meaningful sessions finish, Micro-Dream will synthesize proposals here.',
      });
      return;
    }

    const listContainer = card.createDiv({ cls: 'claudian-plus-mind-list' });
    for (const entry of stagingList) {
      this.renderStagingCard(listContainer, entry);
    }
  }

  private renderStagingCard(container: HTMLElement, entry: StagingMindEntry): void {
    const card = container.createDiv({ cls: 'claudian-plus-staging-card' });

    const metaRow = card.createDiv({ cls: 'claudian-plus-mind-meta-row' });
    metaRow.createSpan({
      cls: `claudian-plus-mind-badge badge-${entry.category}`,
      text: categoryLabel(entry.category, this.isZh),
    });
    metaRow.createSpan({
      cls: 'claudian-plus-mind-scope-pill',
      text: entry.scope === 'global' ? (this.isZh ? '全局偏好' : 'Global') : (this.isZh ? '本库专属' : 'Project'),
    });
    metaRow.createSpan({
      cls: 'claudian-plus-mind-confidence',
      text: `${Math.round(entry.confidence * 100)}% conf`,
    });

    const contentInput = card.createEl('input', {
      cls: 'claudian-plus-mind-content-input',
      type: 'text',
      value: entry.content,
    });

    if (entry.rationale) {
      card.createDiv({
        cls: 'claudian-plus-mind-rationale',
        text: `${this.isZh ? '来源依据: ' : 'Rationale: '}${entry.rationale}`,
      });
    }

    const actionRow = card.createDiv({ cls: 'claudian-plus-mind-action-row' });
    const approveBtn = actionRow.createEl('button', {
      cls: 'claudian-plus-mind-btn-approve mod-cta',
      text: this.isZh ? '采纳' : 'Approve',
    });
    approveBtn.addEventListener('click', () => {
      void (async () => {
        await this.mindStore.approveStaging(entry.id, {
          content: contentInput.value.trim() || entry.content,
        });
        this.onChanged?.();
        await this.render();
      })();
    });

    const dismissBtn = actionRow.createEl('button', {
      cls: 'claudian-plus-mind-btn-dismiss',
      text: this.isZh ? '忽略' : 'Dismiss',
    });
    dismissBtn.addEventListener('click', () => {
      void (async () => {
        await this.mindStore.dismissStaging(entry.id);
        this.onChanged?.();
        await this.render();
      })();
    });
  }

  private renderDurableSection(root: HTMLElement, durableList: DurableMindEntry[]): void {
    const card = root.createDiv({ cls: 'claudian-plus-settings-card' });
    const headerRow = card.createDiv({ cls: 'claudian-plus-mind-section-header' });

    headerRow.createDiv({
      cls: 'claudian-plus-settings-card-header',
      text: this.isZh ? `已生效心智库 (${durableList.length})` : `Active Durable Mind (${durableList.length})`,
    });

    const addBtn = headerRow.createEl('button', {
      cls: 'mod-cta',
      text: this.isZh ? '+ 手动新增规则' : '+ Add Rule',
    });
    addBtn.addEventListener('click', () => {
      void (async () => {
        await this.mindStore.addDurable({
          category: 'user_preference',
          scope: 'global',
          state: 'active',
          content: this.isZh ? '新用户偏好规则' : 'New preference rule',
          confidence: 1.0,
          tags: [],
        });
        this.onChanged?.();
        await this.render();
      })();
    });

    // Filter controls
    const filterRow = card.createDiv({ cls: 'claudian-plus-mind-filter-row' });
    const searchInput = filterRow.createEl('input', {
      type: 'text',
      cls: 'claudian-plus-mind-search-input',
      placeholder: this.isZh ? '搜索已生效规则...' : 'Search durable rules...',
    });
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      this.filterAndRenderDurableCards(listContainer, durableList);
    });

    const listContainer = card.createDiv({ cls: 'claudian-plus-mind-list' });
    this.filterAndRenderDurableCards(listContainer, durableList);
  }

  private filterAndRenderDurableCards(container: HTMLElement, list: DurableMindEntry[]): void {
    container.empty();

    let filtered = list;
    if (this.selectedScopeFilter !== 'all') {
      filtered = filtered.filter((e) => e.scope === this.selectedScopeFilter);
    }
    if (this.searchQuery) {
      filtered = filtered.filter(
        (e) =>
          e.content.toLowerCase().includes(this.searchQuery) ||
          e.tags.some((t) => t.toLowerCase().includes(this.searchQuery)),
      );
    }

    if (filtered.length === 0) {
      container.createDiv({
        cls: 'claudian-plus-mind-empty-hint',
        text: this.isZh ? '未找到匹配的规则' : 'No matching rules found',
      });
      return;
    }

    for (const entry of filtered) {
      this.renderDurableCard(container, entry);
    }
  }

  private renderDurableCard(container: HTMLElement, entry: DurableMindEntry): void {
    const card = container.createDiv({ cls: 'claudian-plus-durable-card' });

    const metaRow = card.createDiv({ cls: 'claudian-plus-mind-meta-row' });
    metaRow.createSpan({
      cls: `claudian-plus-mind-badge badge-${entry.category}`,
      text: categoryLabel(entry.category, this.isZh),
    });
    metaRow.createSpan({
      cls: 'claudian-plus-mind-scope-pill',
      text: entry.scope === 'global' ? (this.isZh ? '全局' : 'Global') : (this.isZh ? '本库' : 'Project'),
    });
    metaRow.createSpan({
      cls: 'claudian-plus-mind-state-tag',
      text: entry.state === 'active' ? (this.isZh ? '● 活跃' : '● Active') : (this.isZh ? '○ 过时' : '○ Stale'),
    });

    const contentInput = card.createEl('input', {
      cls: 'claudian-plus-mind-content-input',
      type: 'text',
      value: entry.content,
    });
    contentInput.addEventListener('change', () => {
      void (async () => {
        await this.mindStore.updateDurable(entry.id, {
          content: contentInput.value.trim(),
        });
        this.onChanged?.();
      })();
    });

    const actionRow = card.createDiv({ cls: 'claudian-plus-mind-action-row' });
    const deleteBtn = actionRow.createEl('button', {
      cls: 'claudian-plus-mind-btn-delete',
      text: this.isZh ? '删除' : 'Delete',
    });
    deleteBtn.addEventListener('click', () => {
      void (async () => {
        await this.mindStore.deleteDurable(entry.id);
        this.onChanged?.();
        await this.render();
      })();
    });
  }

  private async renderV2Section(root: HTMLElement): Promise<void> {
    if (!this.memoryRepository) {
      return;
    }

    const card = root.createDiv({ cls: 'claudian-plus-settings-card' });
    const headerRow = card.createDiv({ cls: 'claudian-plus-mind-section-header' });

    const records = await this.memoryRepository.listRecords({ status: 'active' });
    const currentGen = await this.memoryRepository.getCurrentGeneration();
    const jobs = await this.memoryRepository.listJobs();
    const pendingJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'deferred');

    headerRow.createDiv({
      cls: 'claudian-plus-settings-card-header',
      text: this.isZh ? `记忆仓库 V2 (${records.length})` : `Memory Repository V2 (${records.length})`,
    });

    const actionsEl = headerRow.createDiv({ cls: 'claudian-plus-mind-header-actions' });
    if (this.memoryCoordinator) {
      const dreamBtn = actionsEl.createEl('button', {
        cls: 'mod-cta',
        text: this.isZh ? '立即做梦整理' : 'Consolidate Now',
      });
      dreamBtn.addEventListener('click', () => {
        void (async () => {
          if (!this.memoryCoordinator) return;
          const res = await this.memoryCoordinator.processPendingJobs();
          new Notice(
            this.isZh
              ? `已整理 ${res.processed} 条任务, 延后 ${res.deferred}, 失败 ${res.failed}`
              : `Consolidated: ${res.processed} processed, ${res.deferred} deferred, ${res.failed} failed`,
          );
          this.onChanged?.();
          await this.render();
        })();
      });
    }

    const addBtn = actionsEl.createEl('button', {
      text: this.isZh ? '+ 添加偏好' : '+ Add Preference',
    });
    addBtn.addEventListener('click', () => {
      void (async () => {
        if (!this.memoryRepository) return;
        const defaultContent = this.isZh ? '新用户偏好' : 'New user preference';
        const claimKey = `pref_manual_${Date.now()}`;
        await this.memoryRepository.commitExplicit({
          action: 'remember',
          kind: 'profile',
          claimKey,
          content: defaultContent,
          scope: { vaultId: 'default' },
        });
        this.onChanged?.();
        await this.render();
      })();
    });

    // Subtitle / meta row showing generation & pending jobs info
    const infoRow = card.createDiv({ cls: 'claudian-plus-mind-meta-row' });
    infoRow.createSpan({
      cls: 'claudian-plus-mind-scope-pill',
      text: `Generation: ${currentGen || 'initial'}`,
    });
    if (pendingJobs.length > 0) {
      infoRow.createSpan({
        cls: 'claudian-plus-mind-confidence',
        text: this.isZh ? `排队任务: ${pendingJobs.length}` : `Pending jobs: ${pendingJobs.length}`,
      });
    }

    if (records.length === 0) {
      card.createDiv({
        cls: 'claudian-plus-mind-empty-hint',
        text: this.isZh
          ? '仓库中暂无活跃的 V2 记忆。对话完成后，系统将自动增量提炼为经历与长期记忆。'
          : 'No active V2 memories. Completed conversations are automatically consolidated into long-term memories.',
      });
      return;
    }

    // Filter row for V2 records
    const filterRow = card.createDiv({ cls: 'claudian-plus-mind-filter-row' });
    const v2SearchInput = filterRow.createEl('input', {
      type: 'text',
      cls: 'claudian-plus-mind-search-input',
      placeholder: this.isZh ? '搜索 V2 记忆或 claimKey...' : 'Search V2 memories or claimKey...',
    });
    v2SearchInput.value = this.v2SearchQuery;

    const listContainer = card.createDiv({ cls: 'claudian-plus-mind-list' });

    const renderFilteredV2Cards = () => {
      listContainer.empty();
      let filtered = records;
      if (this.v2SearchQuery) {
        filtered = filtered.filter(
          (r) =>
            r.content.toLowerCase().includes(this.v2SearchQuery) ||
            r.claimKey.toLowerCase().includes(this.v2SearchQuery) ||
            r.kind.toLowerCase().includes(this.v2SearchQuery),
        );
      }
      if (filtered.length === 0) {
        listContainer.createDiv({
          cls: 'claudian-plus-mind-empty-hint',
          text: this.isZh ? '未找到匹配的 V2 记忆' : 'No matching V2 memories found',
        });
        return;
      }
      for (const record of filtered) {
        this.renderV2RecordCard(listContainer, record);
      }
    };

    v2SearchInput.addEventListener('input', () => {
      this.v2SearchQuery = v2SearchInput.value.trim().toLowerCase();
      renderFilteredV2Cards();
    });

    renderFilteredV2Cards();
  }

  private renderV2RecordCard(container: HTMLElement, record: MemoryRecord): void {
    const card = container.createDiv({ cls: 'claudian-plus-durable-card' });

    const metaRow = card.createDiv({ cls: 'claudian-plus-mind-meta-row' });
    const kindClass =
      record.kind === 'profile'
        ? 'badge-user_preference'
        : record.kind === 'project_state'
          ? 'badge-project_rule'
          : 'badge-correction_rule';

    metaRow.createSpan({
      cls: `claudian-plus-mind-badge ${kindClass}`,
      text: record.kind.toUpperCase(),
    });
    metaRow.createSpan({
      cls: 'claudian-plus-mind-scope-pill',
      text: record.scope.projectId ? `Project: ${record.scope.projectId}` : 'Vault',
    });
    metaRow.createSpan({
      cls: 'claudian-plus-mind-confidence',
      text: `key: ${record.claimKey}`,
    });
    metaRow.createSpan({
      cls: 'claudian-plus-mind-state-tag',
      text: `basis: ${record.basis} (rev ${record.revision})`,
    });

    const contentInput = card.createEl('input', {
      cls: 'claudian-plus-mind-content-input',
      type: 'text',
      value: record.content,
    });
    contentInput.addEventListener('change', () => {
      void (async () => {
        if (!this.memoryRepository) return;
        const newContent = contentInput.value.trim();
        if (newContent && newContent !== record.content) {
          await this.memoryRepository.commitExplicit({
            action: 'correct',
            kind: record.kind,
            claimKey: record.claimKey,
            content: newContent,
            scope: record.scope,
            reason: 'User edited in settings',
          });
          this.onChanged?.();
        }
      })();
    });

    const actionRow = card.createDiv({ cls: 'claudian-plus-mind-action-row' });
    const deleteBtn = actionRow.createEl('button', {
      cls: 'claudian-plus-mind-btn-delete',
      text: this.isZh ? '遗忘' : 'Forget',
    });
    deleteBtn.addEventListener('click', () => {
      void (async () => {
        if (!this.memoryRepository) return;
        await this.memoryRepository.commitExplicit({
          action: 'forget',
          claimKey: record.claimKey,
          scope: record.scope,
          reason: 'User forgot in settings',
        });
        this.onChanged?.();
        await this.render();
      })();
    });
  }
}
