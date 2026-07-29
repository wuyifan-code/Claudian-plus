import type { App } from 'obsidian';
import { Notice } from 'obsidian';

import { buildVaultInsights, type InsightSource, type VaultInsightReport } from './VaultInsightService';
import type { VaultRetrievalService } from './VaultRetrievalService';

export type ReviewFrequency = 'daily' | 'weekly' | 'monthly';

export interface ReviewConfig {
  enabled: boolean;
  frequency: ReviewFrequency;
  outputFolder: string;
}

const DEFAULT_CONFIG: ReviewConfig = {
  enabled: false,
  frequency: 'weekly',
  outputFolder: '',
};

/**
 * Generates periodic vault review reports.
 * Scans recent changes and produces a Markdown summary note.
 */
export class VaultReviewService {
  private config: ReviewConfig;
  private lastReviewDate = '';

  constructor(
    private app: App,
    config?: Partial<ReviewConfig>,
    private readonly retrievalService: VaultRetrievalService | null = null,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastReviewDate = this.readLastReviewDate();
  }

  updateConfig(config: Partial<ReviewConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Returns the interval in ms at which to check whether a review is due. */
  getCheckInterval(): number {
    // Check every hour for due reviews
    return 60 * 60 * 1000;
  }

  /** Returns true if enough time has passed since the last review. */
  isReviewDue(): boolean {
    if (!this.config.enabled) return false;
    const today = this.getDateKey();
    if (today === this.lastReviewDate) return false;

    if (!this.lastReviewDate) return true; // First time

    const last = new Date(this.lastReviewDate);
    const now = new Date();

    switch (this.config.frequency) {
      case 'daily':
        return true; // Last review was some other day
      case 'weekly': {
        const daysSinceLast = (now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000);
        return daysSinceLast >= 7;
      }
      case 'monthly': {
        const monthsSinceLast = (now.getFullYear() - last.getFullYear()) * 12
          + now.getMonth() - last.getMonth();
        return monthsSinceLast >= 1;
      }
    }
  }

  /** Runs the review and generates a report note. */
  async runReview(force = false): Promise<void> {
    if (!this.config.enabled) {
      if (force) {
        this.config.enabled = true;
      } else {
        new Notice('Vault review is disabled. Enable consciousness/auto-memory in settings.');
        return;
      }
    }

    const now = new Date();
    const todayKey = this.getDateKey();
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const lines: string[] = [];

    // Determine the period
    let lookbackMs: number;
    switch (this.config.frequency) {
      case 'daily': lookbackMs = 24 * 60 * 60 * 1000; break;
      case 'weekly': lookbackMs = 7 * 24 * 60 * 60 * 1000; break;
      case 'monthly': lookbackMs = 30 * 24 * 60 * 60 * 1000; break;
    }

    lines.push('---');
    lines.push(`created: ${now.toISOString().slice(0, 10)}`);
    lines.push('type: claudian-plus-review');
    lines.push(`review-period: ${this.config.frequency}`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${this.capitalize(this.config.frequency)} Vault Review — ${now.toLocaleDateString()}`);
    lines.push('');
    lines.push(`Total vault size: ${markdownFiles.length} files`);
    lines.push('');

    // Recent files
    const recent = markdownFiles
      .filter(f => f.stat.mtime > now.getTime() - lookbackMs)
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    const relatedSources = await this.collectRelatedSources(recent);
    const unresolvedLinks = this.collectUnresolvedLinks();
    const insights = await this.collectInsights(recent, unresolvedLinks);

    if (recent.length > 0) {
      lines.push('## 📝 Recently Modified');
      lines.push('');
      for (const f of recent.slice(0, 20)) {
        const date = new Date(f.stat.mtime).toLocaleDateString();
        lines.push(`- ${date} — \`${f.path}\``);
      }
      if (recent.length > 20) {
        lines.push(`- … and ${recent.length - 20} more files`);
      }
      lines.push('');
    }

    if (relatedSources.length > 0) {
      lines.push('## Related notes');
      lines.push('');
      lines.push('These source-backed connections were found locally from the notes changed in this review period:');
      lines.push('');
      for (const source of relatedSources) {
        lines.push(`- [[${source.path.replace(/\.md$/i, '')}]]${source.heading ? ` > ${source.heading}` : ''} — ${source.excerpt}`);
      }
      lines.push('');
    }

    this.appendInsightSections(lines, insights);

    // Link health snapshot
    const totalUnresolved = Object.values(unresolvedLinks)
      .reduce((sum, links) => sum + Object.keys(links).length, 0);
    lines.push(`## 🔗 Link Health Snapshot`);
    lines.push('');
    lines.push(`- Broken links: ${totalUnresolved}`);
    if (totalUnresolved > 0) {
      lines.push(`- Consider running "Check vault link health" to see details.`);
    }
    lines.push('');

    // Questions for reflection
    lines.push('## 💭 Reflection Prompts');
    lines.push('');
    lines.push(`1. Are there any patterns in what you've been working on this ${this.config.frequency}?`);
    lines.push('2. Are there notes that need to be consolidated or linked?');
    lines.push('3. What should you focus on next?');
    lines.push('');
    lines.push('---');
    lines.push(`_Auto-generated by Claudian Plus review (${this.config.frequency})_`);

    // Write the file
    const content = lines.join('\n');
    const folder = this.config.outputFolder || '';
    const fileName = folder
      ? `${folder}/${todayKey}-review.md`
      : `${todayKey}-review.md`;

    try {
      const existing = this.app.vault.getAbstractFileByPath(fileName);
      if (!existing) {
        await this.app.vault.create(fileName, content);
      } else {
        const existingFile = this.app.vault.getFileByPath(fileName);
        if (existingFile) {
          await this.app.vault.modify(existingFile, content);
        }
      }
      this.lastReviewDate = todayKey;
      this.writeLastReviewDate(todayKey);
      new Notice(`Vault review generated: ${fileName}`);
    } catch (error) {
      console.error('[Claudian Plus] Failed to generate review:', error);
    }
  }

  private async collectRelatedSources(
    recent: Array<{ path: string; basename: string }>,
  ): Promise<Array<{ path: string; heading: string; excerpt: string }>> {
    if (!this.retrievalService || recent.length === 0) return [];

    try {
      await this.retrievalService.warmup();
      const seen = new Set<string>();
      const related: Array<{ path: string; heading: string; excerpt: string }> = [];
      for (const file of recent.slice(0, 6)) {
        const results = await this.retrievalService.search(file.basename, { limit: 3, maxExcerptLength: 180 });
        for (const result of results) {
          if (result.path === file.path || seen.has(result.path)) continue;
          seen.add(result.path);
          related.push({ path: result.path, heading: result.heading, excerpt: result.excerpt });
          if (related.length >= 10) return related;
        }
      }
      return related;
    } catch {
      // A review is still valuable without retrieval-backed connections.
      return [];
    }
  }

  private async collectInsights(
    recent: Array<{ path: string; stat: { mtime: number } }>,
    unresolvedLinks: Record<string, Record<string, number>>,
  ): Promise<VaultInsightReport> {
    const sources: InsightSource[] = [];
    const vault = this.app.vault as unknown as {
      cachedRead?: (file: unknown) => Promise<string>;
      read?: (file: unknown) => Promise<string>;
    };

    for (const file of recent.slice(0, 100)) {
      try {
        const reader = vault.cachedRead ?? vault.read;
        if (!reader) break;
        const text = await reader.call(this.app.vault, file);
        if (typeof text === 'string') {
          sources.push({ path: file.path, text, modifiedAt: file.stat.mtime });
        }
      } catch {
        // One locked or deleted note must not prevent the rest of the review.
      }
    }

    return buildVaultInsights(sources, unresolvedLinks);
  }

  private collectUnresolvedLinks(): Record<string, Record<string, number>> {
    const metadataCache = this.app.metadataCache as unknown as Record<string, unknown>;
    const unresolvedLinks = metadataCache.unresolvedLinks;
    return typeof unresolvedLinks === 'object' && unresolvedLinks
      ? unresolvedLinks as Record<string, Record<string, number>>
      : {};
  }

  private appendInsightSections(lines: string[], insights: VaultInsightReport): void {
    if (insights.sourceCount === 0) return;

    lines.push('## Local insight signals');
    lines.push('');
    lines.push(`Signals are derived locally from ${insights.sourceCount} recently modified source note(s); each item links back to its evidence.`);
    lines.push('');

    if (insights.topics.length > 0) {
      lines.push('### Recurring topics');
      lines.push('');
      for (const topic of insights.topics) {
        const sources = topic.sourcePaths.slice(0, 3)
          .map(path => `[[${path.replace(/\.md$/i, '')}]]`)
          .join(', ');
        lines.push(`- **${topic.term}** — ${topic.count} mentions across ${topic.sourcePaths.length} note(s): ${sources}`);
      }
      lines.push('');
    }

    if (insights.openLoops.length > 0) {
      lines.push('### Open loops');
      lines.push('');
      for (const loop of insights.openLoops) {
        lines.push(`- [ ] ${loop.text} — [[${loop.path.replace(/\.md$/i, '')}]] (line ${loop.line})`);
      }
      lines.push('');
    }

    if (insights.linkSignals.length > 0) {
      lines.push('### Link activity');
      lines.push('');
      for (const signal of insights.linkSignals) {
        const broken = signal.brokenCount > 0 ? `, ${signal.brokenCount} unresolved` : '';
        lines.push(`- [[${signal.path.replace(/\.md$/i, '')}]] — ${signal.outgoingCount} outgoing link(s)${broken}`);
      }
      lines.push('');
    }

    lines.push('### Suggested follow-ups');
    lines.push('');
    if (insights.topics[0]) {
      lines.push(`- Review the recurring topic **${insights.topics[0].term}** and decide whether it deserves a hub/MOC note.`);
    }
    if (insights.openLoops.length > 0) {
      lines.push(`- Resolve or reschedule the ${insights.openLoops.length} open loop(s) surfaced above.`);
    }
    if (insights.linkSignals.some(signal => signal.brokenCount > 0)) {
      lines.push('- Repair unresolved links before adding more references to the same topic cluster.');
    }
    lines.push('');
  }

  private getDateKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private readLastReviewDate(): string {
    try {
      return window.localStorage?.getItem('claudian-plus-last-review-date')
        ?? window.localStorage?.getItem('claudian-last-review-date')
        ?? '';
    } catch {
      // Storage can be unavailable in tests, popouts, or restricted modes.
      return '';
    }
  }

  private writeLastReviewDate(value: string): void {
    try {
      window.localStorage?.setItem('claudian-plus-last-review-date', value);
    } catch {
      // Review output is still useful when localStorage is unavailable.
    }
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
