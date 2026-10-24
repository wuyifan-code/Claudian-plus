import { Notice } from 'obsidian';

import type { MemoryCoordinator } from '../../core/memory/v2/MemoryCoordinator';
import type { MemoryRepository } from '../../core/memory/v2/MemoryRepository';
import type { MemoryRecord } from '../../core/memory/v2/types';

export interface MindSettingsTabOptions {
  containerEl: HTMLElement;
  memoryRepository: MemoryRepository;
  memoryCoordinator?: MemoryCoordinator;
  locale?: string;
  onChanged?: () => void;
}

export class MindSettingsTab {
  private readonly containerEl: HTMLElement;
  private readonly repo: MemoryRepository;
  private readonly memoryCoordinator?: MemoryCoordinator;
  private readonly isZh: boolean;
  private readonly onChanged?: () => void;

  private v2SearchQuery = '';

  constructor(options: MindSettingsTabOptions) {
    this.containerEl = options.containerEl;
    this.repo = options.memoryRepository;
    this.memoryCoordinator = options.memoryCoordinator;
    this.isZh = (options.locale ?? 'en').toLowerCase().startsWith('zh');
    this.onChanged = options.onChanged;
  }

  async render(): Promise<void> {
    this.containerEl.empty();
    const root = this.containerEl.createDiv({ cls: 'claudian-plus-mind-settings' });

    await this.repo.initialize().catch(() => undefined);
    const candidates = await this.repo.listRecords({ status: 'candidate' });

    this.renderHeader(root);
    this.renderCandidateSection(root, candidates);
    await this.renderV2Section(root);
  }

  private renderHeader(root: HTMLElement): void {
    const card = root.createDiv({ cls: 'claudian-plus-settings-card' });
    const header = card.createDiv({
      cls: 'claudian-plus-settings-card-header',
      text: this.isZh ? '记忆与微梦境 (V2)' : 'Memory & Micro-Dreams (V2)',
    });
    header.createDiv({
      cls: 'claudian-plus-settings-feature-guide-copy',
      text: this.isZh
        ? '会话结束后自动提炼的记忆建议会先进入草稿箱，经你确认后才会注入后续对话；已生效的记忆可在下方管理。'
        : 'Session-end micro-dream proposals land in the review queue before injection; approved memories are managed below.',
    });
  }

  private renderCandidateSection(root: HTMLElement, candidates: MemoryRecord[]): void {
    const card = root.createDiv({ cls: 'claudian-plus-settings-card' });
    const headerRow = card.createDiv({ cls: 'claudian-plus-mind-section-header' });

    headerRow.createDiv({
      cls: 'claudian-plus-settings-card-header',
      text: this.isZh ? `待审草稿箱 (${candidates.length})` : `Review Queue (${candidates.length})`,
    });

    if (candidates.length > 0) {
      const actionsEl = headerRow.createDiv({ cls: 'claudian-plus-mind-header-actions' });
      const approveAllBtn = actionsEl.createEl('button', {
        cls: 'mod-cta',
        text: this.isZh ? '全部采纳' : 'Approve All',
      });
      approveAllBtn.addEventListener('click', () => {
        void (async () => {
          for (const candidate of candidates) {
            await this.repo.approveCandidate(candidate.id).catch(() => null);
          }
          this.onChanged?.();
          await this.render();
        })();
      });
    }

    if (candidates.length === 0) {
      card.createDiv({
        cls: 'claudian-plus-mind-empty-hint',
        text: this.isZh
          ? '暂无待审草稿。当长会话结束时，微梦境将自动在此生成记忆建议。'
          : 'No pending candidates. When meaningful sessions finish, micro-dreams will propose memories here.',
      });
      return;
    }

    const listContainer = card.createDiv({ cls: 'claudian-plus-mind-list' });
    for (const entry of candidates) {
      this.renderCandidateCard(listContainer, entry);
    }
  }

  private renderCandidateCard(container: HTMLElement, entry: MemoryRecord): void {
    const card = container.createDiv({ cls: 'claudian-plus-staging-card' });

    const metaRow = card.createDiv({ cls: 'claudian-plus-mind-meta-row' });
    metaRow.createSpan({
      cls: 'claudian-plus-mind-badge',
      text: entry.kind.toUpperCase(),
    });
    metaRow.createSpan({
      cls: 'claudian-plus-mind-scope-pill',
      text: entry.scope.projectId
        ? `Project: ${entry.scope.projectId}`
        : this.isZh ? '全库' : 'Vault',
    });

    card.createEl('input', {
      cls: 'claudian-plus-mind-content-input',
      type: 'text',
      value: entry.content,
    });

    const actionRow = card.createDiv({ cls: 'claudian-plus-mind-action-row' });
    const approveBtn = actionRow.createEl('button', {
      cls: 'claudian-plus-mind-btn-approve mod-cta',
      text: this.isZh ? '采纳' : 'Approve',
    });
    approveBtn.addEventListener('click', () => {
      void (async () => {
        await this.repo.approveCandidate(entry.id).catch(() => null);
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
        await this.repo.dismissCandidate(entry.id).catch(() => null);
        this.onChanged?.();
        await this.render();
      })();
    });
  }

  private async renderV2Section(root: HTMLElement): Promise<void> {
    const card = root.createDiv({ cls: 'claudian-plus-settings-card' });
    const headerRow = card.createDiv({ cls: 'claudian-plus-mind-section-header' });

    const records = await this.repo.listRecords({ status: 'active' });
    const currentGen = await this.repo.getCurrentGeneration();
    const jobs = await this.repo.listJobs();
    const pendingJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'deferred');

    headerRow.createDiv({
      cls: 'claudian-plus-settings-card-header',
      text: this.isZh ? `记忆仓库 (${records.length})` : `Memory Repository (${records.length})`,
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
        const defaultContent = this.isZh ? '新用户偏好' : 'New user preference';
        await this.repo.commitExplicit({
          action: 'remember',
          kind: 'profile',
          claimKey: `pref_manual_${Date.now()}`,
          content: defaultContent,
          scope: { vaultId: 'default' },
        }).catch(() => undefined);
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
          ? '仓库中暂无活跃记忆。对话完成后，系统将自动增量提炼为长期记忆。'
          : 'No active memories. Completed conversations are automatically consolidated into long-term memories.',
      });
      return;
    }

    // Filter row for records
    const filterRow = card.createDiv({ cls: 'claudian-plus-mind-filter-row' });
    const v2SearchInput = filterRow.createEl('input', {
      type: 'text',
      cls: 'claudian-plus-mind-search-input',
      placeholder: this.isZh ? '搜索记忆或 claimKey...' : 'Search memories or claimKey...',
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
          text: this.isZh ? '未找到匹配的记忆' : 'No matching memories found',
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
    metaRow.createSpan({
      cls: 'claudian-plus-mind-badge',
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
        const newContent = contentInput.value.trim();
        if (newContent && newContent !== record.content) {
          await this.repo.commitExplicit({
            action: 'correct',
            kind: record.kind,
            claimKey: record.claimKey,
            content: newContent,
            scope: record.scope,
            reason: 'User edited in settings',
          }).catch(() => undefined);
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
        await this.repo.commitExplicit({
          action: 'forget',
          claimKey: record.claimKey,
          scope: record.scope,
          reason: 'User forgot in settings',
        }).catch(() => undefined);
        this.onChanged?.();
        await this.render();
      })();
    });
  }
}
