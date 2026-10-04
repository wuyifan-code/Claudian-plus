import type { MemoryRepository } from './MemoryRepository';
import type {
  MemoryContextPacket,
  MemoryContextRequest,
  MemoryRecallEntry,
  MemoryRecord,
} from './types';

export interface MemoryRetrieverOptions {
  repository: MemoryRepository;
}

interface ScoredRecord {
  record: MemoryRecord;
  score: number;
  reason: string;
}

export class MemoryRetriever {
  private readonly repo: MemoryRepository;

  constructor(options: MemoryRetrieverOptions) {
    this.repo = options.repository;
  }

  async retrieveContext(request: MemoryContextRequest): Promise<MemoryContextPacket> {
    const records = await this.repo.listRecords({ status: 'active' });
    const currentGen = await this.repo.getCurrentGeneration();
    const ledger = await this.repo.getForgetLedger();
    const ledgerRevision = `fl_${ledger.length}`;
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Phase 1: Hard filtering
    const eligibleRecords: MemoryRecord[] = [];
    for (const rec of records) {
      // 1. Scope filter
      if (rec.scope.vaultId !== request.vaultId) {
        continue;
      }
      if (rec.scope.projectId) {
        if (!request.projectId || rec.scope.projectId !== request.projectId) {
          continue;
        }
      }
      if (rec.scope.taskId && request.taskId && rec.scope.taskId !== request.taskId) {
        continue;
      }

      // 2. Validity filter
      if (rec.validFrom !== undefined && rec.validFrom > request.now) {
        continue;
      }
      if (rec.validUntil !== undefined && rec.validUntil <= request.now) {
        continue;
      }
      if (rec.reviewAfter !== undefined && rec.reviewAfter <= request.now) {
        // Stale or needs review, exclude from default active injection
        continue;
      }

      // 3. Forget ledger suppression
      if (this.repo.isSuppressed({ claimKey: rec.claimKey, content: rec.content })) {
        continue;
      }

      eligibleRecords.push(rec);
    }

    if (eligibleRecords.length === 0) {
      return {
        revision: currentGen,
        forgetLedgerRevision: ledgerRevision,
        text: '',
        estimatedTokens: 0,
        traceId,
        entries: [],
      };
    }

    // Phase 2: Scoring
    const queryTokens = this.tokenize(request.userPrompt);
    const activeFileTokens = request.activeFilePaths.flatMap((p) => Array.from(this.tokenize(p)));

    const scored: ScoredRecord[] = [];
    for (const rec of eligibleRecords) {
      const { score, reason } = this.scoreRecord(rec, queryTokens, activeFileTokens);
      if (score > 0) {
        scored.push({ record: rec, score, reason });
      }
    }

    // Sort descending by score, then by recency
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.record.observedAt - a.record.observedAt;
    });

    // Phase 3: Budget and Packing
    const maxTokens = request.maxTokens > 0 ? request.maxTokens : 1200;
    const selectedEntries: MemoryRecallEntry[] = [];
    const profiles: ScoredRecord[] = [];
    const projectStates: ScoredRecord[] = [];
    const lessons: ScoredRecord[] = [];

    for (const s of scored) {
      if (s.record.kind === 'profile') profiles.push(s);
      else if (s.record.kind === 'project_state') projectStates.push(s);
      else if (s.record.kind === 'lesson') lessons.push(s);
    }

    const sections: string[] = [];
    let currentTotalTokens = 40; // Overhead for markdown headers / tags

    const appendGroup = (title: string, group: ScoredRecord[], groupBudget: number) => {
      let groupTokens = 0;
      const lines: string[] = [];

      for (const s of group) {
        const itemText = this.formatRecordLine(s.record);
        const itemTokens = this.estimateTokens(itemText);

        if (groupTokens + itemTokens > groupBudget || currentTotalTokens + itemTokens > maxTokens) {
          continue;
        }

        lines.push(itemText);
        groupTokens += itemTokens;
        currentTotalTokens += itemTokens;

        selectedEntries.push({
          id: s.record.id,
          revision: s.record.revision,
          reason: s.reason,
          kind: s.record.kind,
          claimKey: s.record.claimKey,
          content: s.record.content,
        });
      }

      if (lines.length > 0) {
        sections.push(`### ${title}\n${lines.join('\n')}`);
      }
    };

    // Sub-budgets (default: profile 200, project 600, lesson 400 within maxTokens)
    const profileBudget = Math.min(200, Math.floor(maxTokens * 0.25));
    const projectBudget = Math.min(600, Math.floor(maxTokens * 0.5));
    const lessonBudget = Math.min(400, Math.floor(maxTokens * 0.35));

    appendGroup('User Profile', profiles, profileBudget);
    appendGroup('Project Context', projectStates, projectBudget);
    appendGroup('Lessons & Conventions', lessons, lessonBudget);

    let outputText = '';
    if (sections.length > 0) {
      outputText = [
        '## Active Memory Context',
        '<memory-context>',
        sections.join('\n\n'),
        '</memory-context>',
      ].join('\n');
    }

    return {
      revision: currentGen,
      forgetLedgerRevision: ledgerRevision,
      text: outputText,
      estimatedTokens: this.estimateTokens(outputText),
      traceId,
      entries: selectedEntries,
    };
  }

  private scoreRecord(
    rec: MemoryRecord,
    queryTokens: Set<string>,
    fileTokens: string[],
  ): { score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    // Base score by kind
    if (rec.kind === 'profile') {
      score += 6; // Profiles are generally applicable
      reasons.push('base_profile');
    } else if (rec.kind === 'project_state') {
      score += 5; // Current project state
      reasons.push('base_project');
    } else {
      score += 1; // Lessons need relevance
    }

    const recTokens = this.tokenize(`${rec.claimKey} ${rec.content} ${(rec.conditions ?? []).join(' ')}`);

    let matchCount = 0;
    for (const token of queryTokens) {
      if (recTokens.has(token)) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      score += matchCount * 3;
      reasons.push(`keyword_match:${matchCount}`);
    }

    // Condition / file path match
    if (rec.conditions && rec.conditions.length > 0) {
      for (const cond of rec.conditions) {
        const condTokens = this.tokenize(cond);
        for (const ct of condTokens) {
          if (queryTokens.has(ct) || fileTokens.includes(ct)) {
            score += 8;
            reasons.push(`condition_match:${ct}`);
            break;
          }
        }
      }
    }

    // Outcome bonus
    if (rec.outcome === 'succeeded') {
      score += 2;
    }

    // If lesson has no match and score is too low, filter out
    if (rec.kind === 'lesson' && matchCount === 0 && !reasons.some((r) => r.startsWith('condition_match'))) {
      return { score: 0, reason: 'no_relevance' };
    }

    return { score, reason: reasons.join(',') };
  }

  private formatRecordLine(rec: MemoryRecord): string {
    const conditionStr = rec.conditions && rec.conditions.length > 0 ? ` (Condition: ${rec.conditions.join(', ')})` : '';
    return `- [${rec.claimKey}] ${rec.content}${conditionStr}`;
  }

  private tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    if (!text) return tokens;

    // 1. English words / alphanumeric
    const words = text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];
    for (const w of words) {
      tokens.add(w);
    }

    // 2. CJK characters n-grams (bigrams & trigrams)
    const cjkChars = text.match(/[\u4e00-\u9fa5]/g);
    if (cjkChars && cjkChars.length >= 2) {
      for (let i = 0; i < cjkChars.length - 1; i++) {
        tokens.add(cjkChars[i] + cjkChars[i + 1]);
        if (i < cjkChars.length - 2) {
          tokens.add(cjkChars[i] + cjkChars[i + 1] + cjkChars[i + 2]);
        }
      }
    }

    return tokens;
  }

  private estimateTokens(text: string): number {
    if (!text) return 0;
    // Conservative estimate: ~4 chars per Latin token, ~1.5 chars per CJK token
    let cjkCount = 0;
    let nonCjkCount = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x4e00 && code <= 0x9fa5) {
        cjkCount++;
      } else {
        nonCjkCount++;
      }
    }
    return Math.ceil(nonCjkCount / 4 + cjkCount / 1.5);
  }
}
