import { type App, Modal, Notice, type TFile } from 'obsidian';

import type {
  InsightSource,
  MocSuggestion,
  TagNormalizationSuggestion,
} from '../../core/retrieval/VaultInsightService';
import {
  buildMocSuggestions,
  buildTagNormalizations,
} from '../../core/retrieval/VaultInsightService';
import type { SemanticIndexProgress, VaultRetrievalService } from '../../core/retrieval/VaultRetrievalService';

interface HealthStats {
  totalFiles: number;
  resolvedFiles: number;
  brokenLinks: number;
  topBrokenTargets: Array<{ target: string; count: number }>;
  orphanCount: number;
  orphanSamples: string[];
  recentCount: number;
  recentSamples: Array<{ path: string; date: string }>;
  tagCount: number;
  topTags: Array<{ tag: string; count: number }>;
  todoCount: number;
  todoSamples: Array<{ path: string; line: string }>;
  retrieval: {
    ready: boolean;
    fileCount: number;
    blockCount: number;
    semanticEnabled?: boolean;
    semanticReady?: boolean;
    semanticIndexedBlockCount?: number;
    semanticTotalBlockCount?: number;
    semanticStatus?: 'disabled' | 'idle' | 'indexing' | 'ready' | 'error';
    semanticError?: string | null;
  } | null;
  tagNormalizations: TagNormalizationSuggestion[];
  mocSuggestions: MocSuggestion[];
}

export interface VaultHealthModalOptions {
  retrievalService?: VaultRetrievalService | null;
  onAskAgent?: (prompt: string, contextFiles?: string[]) => void;
}

/**
 * Modal showing comprehensive vault health statistics.
 */
export class VaultHealthModal extends Modal {
  private stats: HealthStats | null = null;
  private loading = true;
  private unsubscribeProgress: (() => void) | null = null;
  private semanticProgressEl: HTMLElement | null = null;
  private semanticProgressBarEl: HTMLProgressElement | null = null;
  private semanticEtaEl: HTMLElement | null = null;
  private semanticCancelBtn: HTMLButtonElement | null = null;
  private semanticStartedAt: number | null = null;
  private readonly retrievalService: VaultRetrievalService | null;
  private readonly onAskAgent: ((prompt: string, contextFiles?: string[]) => void) | null;

  constructor(app: App, options: VaultHealthModalOptions = {}) {
    super(app);
    this.setTitle('Vault Health');
    this.retrievalService = options.retrievalService ?? null;
    this.onAskAgent = options.onAskAgent ?? null;
  }

  async onOpen(): Promise<void> {
    this.renderLoading();
    try {
      this.stats = await this.collectStats();
      const markdownFiles = this.app.vault.getMarkdownFiles();
      const insights = await this.collectInsights(markdownFiles);
      this.stats.tagNormalizations = insights.tagNormalizations;
      this.stats.mocSuggestions = insights.mocSuggestions;
      this.loading = false;
      this.render();
      this.subscribeToProgress();
    } catch (error) {
      this.loading = false;
      this.contentEl.empty();
      this.contentEl.createEl('p', { text: `Failed to load stats: ${error}`, cls: 'mod-error' });
    }
  }

  private subscribeToProgress(): void {
    if (!this.retrievalService) return;
    this.unsubscribeProgress = this.retrievalService.onSemanticProgress((progress) => {
      this.updateSemanticProgress(progress);
    });
  }

  private updateSemanticProgress(progress: SemanticIndexProgress): void {
    if (!this.semanticProgressEl) return;

    // Reset/start/stop the local ETA clock in lockstep with indexing lifecycle.
    if (progress.status === 'indexing') {
      if (this.semanticStartedAt === null) this.semanticStartedAt = Date.now();
    } else {
      this.semanticStartedAt = null;
    }

    if (progress.status === 'indexing') {
      const etaText = this.formatSemanticEta(progress);
      this.semanticProgressEl.setText(
        `Semantic index ${progress.indexedBlocks}/${progress.totalBlocks} sections${etaText ? ` · ${etaText}` : ''}`,
      );
    } else if (progress.status === 'ready') {
      this.semanticProgressEl.setText(
        `Semantic reranking ready (${progress.indexedBlocks} sections)`,
      );
    } else if (progress.status === 'error' && progress.error) {
      this.semanticProgressEl.setText(
        `Semantic reranking unavailable; lexical fallback active (${progress.error})`,
      );
    } else {
      this.semanticProgressEl.setText(`Semantic reranking is ready to index`);
    }

    if (this.semanticProgressBarEl) {
      const total = Math.max(0, progress.totalBlocks);
      const done = Math.max(0, Math.min(progress.indexedBlocks, total));
      this.semanticProgressBarEl.max = total > 0 ? total : 1;
      this.semanticProgressBarEl.value = done;
      // Hide the bar outside indexing — keeps the card tidy when there is
      // nothing in flight.
      this.semanticProgressBarEl.classList.toggle(
        'claudian-plus-health-progress-hidden',
        progress.status !== 'indexing' || total === 0,
      );
    }

    if (this.semanticEtaEl) {
      const etaText = progress.status === 'indexing' ? this.formatSemanticEta(progress) : '';
      this.semanticEtaEl.setText(etaText);
      this.semanticEtaEl.classList.toggle(
        'claudian-plus-health-progress-hidden',
        progress.status !== 'indexing' || etaText === '',
      );
    }

    if (this.semanticCancelBtn) {
      const showCancel = progress.status === 'indexing';
      this.semanticCancelBtn.classList.toggle('claudian-plus-health-progress-hidden', !showCancel);
      // Re-enable the button after a cancel/finish round so the user can cancel again.
      this.semanticCancelBtn.disabled = false;
      this.semanticCancelBtn.setText('Cancel semantic indexing');
    }
  }

  /**
   * Renders the rate + ETA string for the current indexing pass.
   * Returns an empty string when the rate is too low or no blocks have been
   * processed yet — better to show nothing than a misleading "ETA 99h".
   */
  private formatSemanticEta(progress: SemanticIndexProgress): string {
    if (this.semanticStartedAt === null) return '';
    const elapsedMs = Date.now() - this.semanticStartedAt;
    if (elapsedMs < 250) return ''; // too noisy this early
    if (progress.indexedBlocks <= 0) return '';

    const elapsedSec = elapsedMs / 1000;
    const rate = progress.indexedBlocks / elapsedSec; // blocks/sec
    if (!Number.isFinite(rate) || rate <= 0) return '';

    const remaining = Math.max(0, progress.totalBlocks - progress.indexedBlocks);
    const etaSec = remaining / rate;

    return `${rate.toFixed(1)} sections/sec · ETA ${formatDuration(etaSec)}`;
  }

  /**
   * Wires the click handler on the cancel button. Public so tests can re-wire
   * a button created via a code path that bypasses the full render() call.
   */
  wireSemanticCancelHandler(button: HTMLButtonElement): void {
    button.addEventListener('click', () => {
      this.retrievalService?.cancelSemanticWarmup();
      button.disabled = true;
      button.setText('Cancelling...');
    });
  }

  private renderLoading(): void {
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: 'Scanning vault...', cls: 'claudian-plus-health-loading' });
  }

  private render(): void {
    this.contentEl.empty();
    if (!this.stats) return;

    const s = this.stats;

    // Header summary
    const summary = this.contentEl.createDiv({ cls: 'claudian-plus-health-summary' });
    summary.createEl('h3', { text: `Vault: ${s.totalFiles} markdown files` });

    // Stats cards
    const grid = this.contentEl.createDiv({ cls: 'claudian-plus-health-grid' });

    // Link health card
    const linksCard = grid.createDiv({ cls: 'claudian-plus-health-card' });
    linksCard.createEl('h4', { text: '🔗 Links' });
    linksCard.createEl('p', { text: `${s.resolvedFiles} files with links` });
    const brokenP = linksCard.createEl('p');
    if (s.brokenLinks > 0) {
      brokenP.createEl('strong', { text: `${s.brokenLinks} broken` });
      const topList = linksCard.createEl('ul');
      for (const t of s.topBrokenTargets.slice(0, 5)) {
        topList.createEl('li', { text: `\`${t.target}\` (×${t.count})` });
      }
    } else {
      brokenP.setText('All links resolved ✓');
    }

    // Orphan card
    const orphanCard = grid.createDiv({ cls: 'claudian-plus-health-card' });
    orphanCard.createEl('h4', { text: '📄 Orphans' });
    if (s.orphanCount > 0) {
      orphanCard.createEl('p', { text: `${s.orphanCount} note(s) with no incoming links` });
      const list = orphanCard.createEl('ul');
      for (const p of s.orphanSamples.slice(0, 8)) {
        list.createEl('li', { text: p });
      }
      if (this.onAskAgent) {
        const fixOrphansBtn = orphanCard.createEl('button', {
          text: 'Ask agent to link orphans',
          cls: 'claudian-plus-health-fix-btn',
        });
        fixOrphansBtn.addEventListener('click', () => {
          const prompt = `I have ${s.orphanCount} orphan notes with no incoming links. Here are some: ${s.orphanSamples.slice(0, 10).join(', ')}. Suggest where these notes should be linked from and what anchor text to use.`;
          this.onAskAgent?.(prompt, s.orphanSamples.slice(0, 5));
          this.close();
        });
      }
    } else {
      orphanCard.createEl('p', { text: 'No orphans ✓' });
    }

    // Tags & TODO card
    const tagsCard = grid.createDiv({ cls: 'claudian-plus-health-card' });
    tagsCard.createEl('h4', { text: '🏷️ Tags & TODOs' });
    tagsCard.createEl('p', { text: `${s.tagCount} unique tags · ${s.todoCount} open TODOs` });
    if (s.topTags.length > 0) {
      const tagList = tagsCard.createEl('ul');
      for (const t of s.topTags.slice(0, 6)) {
        tagList.createEl('li', { text: `#${t.tag} (${t.count})` });
      }
    }
    if (s.todoCount > 0 && s.todoSamples.length > 0) {
      const todoList = tagsCard.createEl('ul');
      for (const todo of s.todoSamples.slice(0, 4)) {
        todoList.createEl('li', { text: `${todo.path}: ${todo.line.slice(0, 50)}` });
      }
    }

    // Recent card
    const recentCard = grid.createDiv({ cls: 'claudian-plus-health-card' });
    recentCard.createEl('h4', { text: '🕐 Recent (7 days)' });
    recentCard.createEl('p', { text: `${s.recentCount} file(s) modified` });
    const recentList = recentCard.createEl('ul');
    for (const r of s.recentSamples.slice(0, 8)) {
      recentList.createEl('li', { text: `${r.date} — ${r.path}` });
    }

    // Tag normalization card
    if (s.tagNormalizations.length > 0) {
      const tagNormCard = grid.createDiv({ cls: 'claudian-plus-health-card' });
      tagNormCard.createEl('h4', { text: '🏷️ Tag inconsistencies' });
      for (const norm of s.tagNormalizations) {
        const row = tagNormCard.createDiv({ cls: 'claudian-plus-health-insight-row' });
        row.createSpan({ text: `"${norm.canonical}" variants: ${norm.variants.map(v => `"${v}"`).join(', ')}` });
        row.createSpan({ text: `(${norm.sourcePaths.length} files)`, cls: 'claudian-plus-health-muted' });
        const applyBtn = row.createEl('button', { text: 'Normalize', cls: 'claudian-plus-health-fix-btn' });
        applyBtn.addEventListener('click', () => {
          void this.applyTagNormalization(norm).catch(err => {
            new Notice(`Failed to normalize tags: ${err instanceof Error ? err.message : String(err)}`);
          });
        });
      }
    }

    // MOC suggestion card
    if (s.mocSuggestions.length > 0) {
      const mocCard = grid.createDiv({ cls: 'claudian-plus-health-card' });
      mocCard.createEl('h4', { text: '📑 MOC suggestions' });
      for (const moc of s.mocSuggestions) {
        const row = mocCard.createDiv({ cls: 'claudian-plus-health-insight-row' });
        row.createSpan({ text: `${moc.topic}: ${moc.paths.length} notes across ${moc.directories.length} directories` });
        row.createEl('br');
        row.createSpan({ text: `→ ${moc.suggestedMocPath}`, cls: 'claudian-plus-health-muted' });
        const previewBtn = row.createEl('button', { text: 'Preview', cls: 'claudian-plus-health-fix-btn' });
        previewBtn.addEventListener('click', () => {
          void this.previewMoc(moc);
        });
        const createBtn = row.createEl('button', { text: 'Create MOC', cls: 'claudian-plus-health-fix-btn' });
        createBtn.addEventListener('click', () => {
          void this.createMocFile(moc).catch(err => {
            new Notice(`Failed to create MOC: ${err instanceof Error ? err.message : String(err)}`);
          });
        });
      }
    }

    const retrievalCard = grid.createDiv({ cls: 'claudian-plus-health-card' });
    retrievalCard.createEl('h4', { text: 'Retrieval index' });
    if (s.retrieval) {
      retrievalCard.createEl('p', {
        text: s.retrieval.ready
          ? `${s.retrieval.fileCount} files · ${s.retrieval.blockCount} sections indexed`
          : 'Index is warming in the background',
      });
      if (s.retrieval.semanticEnabled) {
        const semanticText = s.retrieval.semanticReady
          ? `Semantic reranking ready (${s.retrieval.semanticIndexedBlockCount ?? 0} sections)`
          : s.retrieval.semanticError
            ? `Semantic reranking unavailable; lexical fallback active (${s.retrieval.semanticError})`
            : s.retrieval.semanticStatus === 'indexing'
              ? `Semantic index ${s.retrieval.semanticIndexedBlockCount ?? 0}/${s.retrieval.semanticTotalBlockCount ?? 0} sections`
              : 'Semantic reranking is ready to index';
        this.semanticProgressEl = retrievalCard.createEl('p', { text: semanticText, cls: 'claudian-plus-health-muted' });
        this.semanticProgressBarEl = retrievalCard.createEl('progress', {
          cls: 'claudian-plus-health-progress claudian-plus-health-progress-hidden',
        });
        this.semanticEtaEl = retrievalCard.createEl('p', {
          text: '',
          cls: 'claudian-plus-health-eta claudian-plus-health-progress-hidden',
        });
        // Always create the cancel button so we can show/hide it from the
        // progress listener when status transitions to 'indexing' after the
        // modal was already open.
        this.semanticCancelBtn = retrievalCard.createEl('button', {
          text: 'Cancel semantic indexing',
          cls: 'claudian-plus-health-progress-hidden',
        });
        this.wireSemanticCancelHandler(this.semanticCancelBtn);
      }
    } else {
      retrievalCard.createEl('p', { text: 'Retrieval index is unavailable' });
    }

    // Action buttons
    const actions = this.contentEl.createDiv({ cls: 'claudian-plus-health-actions' });

    const reportBtn = actions.createEl('button', { text: 'Generate full report', cls: 'mod-cta' });
    reportBtn.addEventListener('click', () => {
      reportBtn.disabled = true;
      void this.generateReport(reportBtn).finally(() => {
        reportBtn.disabled = false;
      });
    });

    if (s.brokenLinks > 0) {
      const fixBtn = actions.createEl('button', { text: 'Ask agent to fix broken links' });
      fixBtn.addEventListener('click', () => {
        const prompt = `I have ${s.brokenLinks} broken links in my vault. The most common missing targets are: ${s.topBrokenTargets.slice(0, 5).map(t => `${t.target} (×${t.count})`).join(', ')}. Help me decide which ones to create and which references to update.`;
        this.onAskAgent?.(prompt);
        this.close();
      });
    }

    const refreshBtn = actions.createEl('button', { text: '↻ Refresh' });
    refreshBtn.addEventListener('click', () => {
      this.loading = true;
      this.renderLoading();
      void this.onOpen();
    });
  }

  private async generateReport(button: HTMLButtonElement): Promise<void> {
    try {
      const stats = this.stats ?? await this.collectStats();
      const folder = '.claudian-plus/reports';
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        try {
          await this.app.vault.createFolder('.claudian-plus');
        } catch {
          // The parent may already exist, or another report generation may
          // have created it concurrently.
        }
        if (!this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
      }

      const dateKey = new Date().toISOString().slice(0, 10);
      const filePath = `${folder}/${dateKey}-vault-health.md`;
      const content = [
        '---',
        `created: ${dateKey}`,
        'type: claudian-plus-vault-health',
        '---',
        '',
        `# Vault health report — ${dateKey}`,
        '',
        `- Markdown files: ${stats.totalFiles}`,
        `- Files with links: ${stats.resolvedFiles}`,
        `- Broken links: ${stats.brokenLinks}`,
        `- Orphan notes: ${stats.orphanCount}`,
        `- Files modified in the last 7 days: ${stats.recentCount}`,
        ...(stats.retrieval ? [
          `- Retrieval index: ${stats.retrieval.fileCount} files, ${stats.retrieval.blockCount} sections, ${stats.retrieval.ready ? 'ready' : 'warming'}`,
          ...(stats.retrieval.semanticEnabled ? [
            `- Semantic reranking: ${stats.retrieval.semanticReady ? `${stats.retrieval.semanticIndexedBlockCount ?? 0} sections ready` : stats.retrieval.semanticStatus === 'indexing' ? `${stats.retrieval.semanticIndexedBlockCount ?? 0}/${stats.retrieval.semanticTotalBlockCount ?? 0} sections indexing` : 'lexical fallback active'}`,
          ] : []),
        ] : []),
        '',
        '## Broken link targets',
        '',
        ...(stats.topBrokenTargets.length > 0
          ? stats.topBrokenTargets.map(item => `- ${item.target} (${item.count})`)
          : ['- None']),
        '',
        '## Orphan notes',
        '',
        ...(stats.orphanSamples.length > 0
          ? stats.orphanSamples.map(path => `- [[${path.replace(/\.md$/i, '')}]]`)
          : ['- None']),
        '',
        '## Recently modified',
        '',
        ...(stats.recentSamples.length > 0
          ? stats.recentSamples.map(item => `- ${item.date} — [[${item.path.replace(/\.md$/i, '')}]]`)
          : ['- None']),
        '',
      ].join('\n');

      const existing = this.app.vault.getFileByPath(filePath);
      if (existing) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(filePath, content);
      }
      new Notice(`Vault health report saved to ${filePath}`);
    } catch (error) {
      new Notice(`Failed to generate vault health report: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      button.textContent = 'Generate full report';
    }
  }

  private async collectStats(): Promise<HealthStats> {
    const mc = this.app.metadataCache as unknown as Record<string, unknown>;
    const resolvedLinks = typeof mc.resolvedLinks === 'object' && mc.resolvedLinks
      ? mc.resolvedLinks as Record<string, unknown> : {};
    const unresolvedLinks = typeof mc.unresolvedLinks === 'object' && mc.unresolvedLinks
      ? mc.unresolvedLinks as Record<string, unknown> : {};

    const markdownFiles = this.app.vault.getMarkdownFiles();
    let retrieval: HealthStats['retrieval'] = null;
    if (this.retrievalService) {
      try {
        await this.retrievalService.warmup();
        retrieval = this.retrievalService.getIndexStats();
      } catch {
        // Link health remains useful when retrieval cache I/O is unavailable.
      }
    }
    const now = Date.now();

    // Broken links
    let totalUnresolved = 0;
    const brokenTargets = new Map<string, number>();
    for (const [, links] of Object.entries(unresolvedLinks)) {
      if (links) {
        for (const target of Object.keys(links)) {
          totalUnresolved++;
          brokenTargets.set(target, (brokenTargets.get(target) ?? 0) + 1);
        }
      }
    }

    // Orphans
    const incomingCounts = new Map<string, number>();
    for (const [, links] of Object.entries(resolvedLinks)) {
      if (links) {
        for (const target of Object.keys(links)) {
          incomingCounts.set(target, (incomingCounts.get(target) ?? 0) + 1);
        }
      }
    }
    const orphans = markdownFiles.filter(f => !incomingCounts.has(f.path));
    const orphanSamples = orphans.slice(0, 20).map(f => f.path);

    // Recent files
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recent = markdownFiles.filter(f => f.stat.mtime > weekAgo)
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    // Tags
    const tagCounts = new Map<string, number>();
    for (const file of markdownFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.tags) {
        for (const tagEntry of cache.tags) {
          const tag = tagEntry.tag.replace(/^#/, '');
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
      if (cache?.frontmatter?.tags) {
        const fmTags = Array.isArray(cache.frontmatter.tags)
          ? cache.frontmatter.tags
          : String(cache.frontmatter.tags).split(/[,\s]+/);
        for (const tag of fmTags) {
          const clean = String(tag).replace(/^#/, '').trim();
          if (clean) tagCounts.set(clean, (tagCounts.get(clean) ?? 0) + 1);
        }
      }
    }

    // TODOs
    let todoCount = 0;
    const todoSamples: Array<{ path: string; line: string }> = [];
    for (const file of markdownFiles.slice(0, 200)) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.listItems) {
        for (const item of cache.listItems) {
          if (item.task && item.task !== 'x' && item.task !== 'X') {
            todoCount++;
            if (todoSamples.length < 10) {
              todoSamples.push({ path: file.path, line: `- [${item.task}] ...` });
            }
          }
        }
      }
    }

    return {
      totalFiles: markdownFiles.length,
      resolvedFiles: Object.keys(resolvedLinks).length,
      brokenLinks: totalUnresolved,
      topBrokenTargets: [...brokenTargets.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([target, count]) => ({ target, count })),
      orphanCount: orphans.length,
      orphanSamples,
      recentCount: recent.length,
      recentSamples: recent.slice(0, 20).map(f => ({
        path: f.path,
        date: new Date(f.stat.mtime).toLocaleDateString(),
      })),
      tagCount: tagCounts.size,
      topTags: [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count })),
      todoCount,
      todoSamples,
      retrieval,
      tagNormalizations: [],
      mocSuggestions: [],
    };
  }

  private async collectInsights(
    markdownFiles: Array<{ path: string; stat: { mtime: number } }>,
  ): Promise<{
    tagNormalizations: TagNormalizationSuggestion[];
    mocSuggestions: MocSuggestion[];
  }> {
    const sources: InsightSource[] = [];
    // Read a representative sample (capped at 200 files)
    const sampleFiles = markdownFiles.slice(0, 200);
    const CONCURRENCY = 8;
    const YIELD_EVERY = 16;

    // Process files in batches of bounded concurrency, yielding the event
    // loop between batches to keep the Obsidian UI responsive.
    for (let offset = 0; offset < sampleFiles.length; offset += CONCURRENCY) {
      if (offset > 0 && offset % YIELD_EVERY === 0) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      }
      const batch = sampleFiles.slice(offset, offset + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (file) => {
          const content = await this.app.vault.cachedRead(file as unknown as TFile);
          return { path: file.path, text: content, modifiedAt: file.stat.mtime };
        }),
      );
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          sources.push(result.value);
        }
        // Rejected → file unreadable, skip silently
      }
    }

    return {
      tagNormalizations: buildTagNormalizations(sources),
      mocSuggestions: buildMocSuggestions(sources),
    };
  }

  onClose(): void {
    this.unsubscribeProgress?.();
    this.unsubscribeProgress = null;
    this.semanticProgressEl = null;
    this.semanticProgressBarEl = null;
    this.semanticEtaEl = null;
    this.semanticCancelBtn = null;
    this.semanticStartedAt = null;
    this.contentEl.empty();
  }

  /**
   * Normalizes tags across files by rewriting frontmatter so every variant
   * of the same tag uses the canonical form. Shows a confirmation dialog
   * before applying changes to avoid accidental bulk rewrites.
   */
  private async applyTagNormalization(suggestion: TagNormalizationSuggestion): Promise<void> {
    const canonical = suggestion.canonical;
    const variants = suggestion.variants.filter(v => v !== canonical);
    if (variants.length === 0) return;

    const confirmMsg = [
      `Normalize ${variants.length} tag variant(s) → "${canonical}"`,
      `in ${suggestion.sourcePaths.length} file(s)?`,
    ].join(' ');
    if (!confirm(confirmMsg)) return;

    let changed = 0;
    for (const path of suggestion.sourcePaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) continue;
      try {
        await this.app.fileManager.processFrontMatter(
          file as TFile,
          (frontmatter: Record<string, unknown>) => {
            const tags = frontmatter['tags'];
            if (!tags) return;
            if (Array.isArray(tags)) {
              frontmatter['tags'] = tags.map((t: unknown) => {
                const clean = String(t).replace(/^#/, '').trim();
                return variants.includes(clean) ? canonical : t;
              });
            } else if (typeof tags === 'string') {
              const parts = String(tags).split(/[,\s]+/).map((t: string) => {
                const clean = t.replace(/^#/, '').trim();
                return variants.includes(clean) ? canonical : t;
              });
              frontmatter['tags'] = parts.join(', ');
            }
          },
        );
        changed += 1;
      } catch {
        // Skip files that can't be processed
      }
    }
    new Notice(`Normalized ${changed} file(s): "${canonical}"`);
  }

  /** Opens a preview of the MOC file content in a notice. */
  private async previewMoc(moc: MocSuggestion): Promise<void> {
    const lines = [
      `# ${moc.topic} — Map of Content`,
      '',
      `> ${moc.paths.length} notes across ${moc.directories.length} directories`,
      '',
      ...moc.paths.map(p => `- [[${p.replace(/\.md$/i, '')}]]`),
    ];
    new Notice(lines.join('\n'), 10000);
  }

  /** Creates the MOC markdown file in the suggested path. */
  private async createMocFile(moc: MocSuggestion): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(moc.suggestedMocPath);
    if (existing) {
      new Notice(`MOC already exists: ${moc.suggestedMocPath}`);
      return;
    }

    const confirmMsg = `Create MOC index for "${moc.topic}" with ${moc.paths.length} links?`;
    if (!confirm(confirmMsg)) return;

    const lines = [
      '---',
      `created: ${new Date().toISOString().slice(0, 10)}`,
      `type: moc`,
      `topic: ${moc.topic}`,
      '---',
      '',
      `# ${moc.topic}`,
      '',
      `> Auto-generated MOC from ${moc.paths.length} notes across ${moc.directories.length} directories.`,
      '',
      ...moc.paths.map(p => `- [[${p.replace(/\.md$/i, '')}]]`),
      '',
    ].join('\n');

    try {
      await this.app.vault.create(moc.suggestedMocPath, lines);
      new Notice(`MOC created: ${moc.suggestedMocPath}`);
    } catch (err) {
      new Notice(`Failed to create MOC: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Renders a duration in seconds as a short human-readable label.
 * `Infinity` and `NaN` collapse to "—"; sub-second to "<1s".
 */
function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  if (totalSeconds < 1) return '<1s';
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds - minutes * 60);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds - hours * 3600) / 60);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
