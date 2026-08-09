import type { AuxQueryRunner } from '../auxiliary/AuxQueryRunner';
import {
  buildDreamPrompt,
  DREAM_DEFAULT_MAX_INPUT_CHARS,
  DREAM_DEFAULT_MAX_INSIGHTS,
  DREAM_DEFAULT_MAX_NEW_FACTS,
  DREAM_DEFAULT_MAX_PROFILE_UPDATES,
  DREAM_MEMORY_SYSTEM_PROMPT,
  type DreamMemoryResult,
  parseDreamMemoryResponse,
  sanitizeDreamResult,
} from '../prompt/dreamMemory';
import type { ProviderId } from '../providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from '../providers/types';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import { type AwarenessState,LEGACY_SHORT_TERM_DIR, SHORT_TERM_DIR } from './consciousness-types';
import type { ConsciousnessEngine } from './ConsciousnessEngine';
import { formatMemoryAppendix } from './memoryPrompt';
import type { MemoryStore } from './MemoryStore';

/** Dream journal and state location under the vault. */
export const DREAM_DIR = '.claudian-plus/awareness/dreams';
export const DREAM_STATE_FILE = `${DREAM_DIR}/state.json`;

/** Bound the processed-log ledger so it cannot grow without limit. */
const MAX_STATE_PROCESSED_LOGS = 400;
/** Check interval for the periodic dream trigger (matches vault review cadence). */
export const DREAM_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface DreamState {
  lastDreamAt: number;
  processedLogs: string[];
}

export interface DreamServiceConfig {
  /** Minimum interval between automatic dreams in ms. */
  intervalMs?: number;
  /** How many recent days of logs to consider. */
  maxLogDays?: number;
  /** Input character budget for one dream. */
  inputCharCap?: number;
  maxNewFacts?: number;
  maxProfileUpdates?: number;
  maxInsights?: number;
}

export interface DreamRunResult {
  ran: boolean;
  reason?: 'disabled' | 'already-running' | 'no-new-logs' | 'failed';
  error?: string;
  newFacts: number;
  profileUpdates: number;
  insights: number;
  journalPath?: string;
}

export interface DreamServiceDependencies {
  adapter: VaultFileAdapter;
  memoryStore: MemoryStore;
  consciousness: ConsciousnessEngine;
  /** Provider-neutral runner factory (e.g. ProviderRegistry.createAuxQueryRunner). */
  createRunner: (providerId: ProviderId) => AuxQueryRunner;
  /** Active conversation context (provider + model). Null falls back to the default provider. */
  getConversationContext?: () => { providerId: ProviderId; model: string | null } | null;
  /** Feature gate. Defaults to consciousness enabled + auto-memory enabled. */
  isEnabled?: () => boolean;
  config?: DreamServiceConfig;
}

const DEFAULT_DREAM_CONFIG: Required<DreamServiceConfig> = {
  intervalMs: 24 * 60 * 60 * 1000,
  maxLogDays: 7,
  inputCharCap: DREAM_DEFAULT_MAX_INPUT_CHARS,
  maxNewFacts: DREAM_DEFAULT_MAX_NEW_FACTS,
  maxProfileUpdates: DREAM_DEFAULT_MAX_PROFILE_UPDATES,
  maxInsights: DREAM_DEFAULT_MAX_INSIGHTS,
};

function normalizeContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isDatedLog(basename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(basename);
}

/**
 * DreamService consolidates short-term conversation logs into long-term
 * memory. During a "dream" phase, a lightweight model call distills the
 * accumulated logs into durable facts, profile updates, and insights, which
 * are then written back through the existing MemoryStore and
 * ConsciousnessEngine boundaries.
 */
export class DreamService {
  private readonly config: Required<DreamServiceConfig>;
  private running = false;

  constructor(private readonly deps: DreamServiceDependencies) {
    this.config = {
      ...DEFAULT_DREAM_CONFIG,
      ...(deps.config
        ? Object.fromEntries(
          Object.entries(deps.config)
            .filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
        )
        : {}),
    };
  }

  get enabled(): boolean {
    return this.deps.isEnabled?.() ?? (
      this.deps.consciousness.enabled && this.deps.consciousness.autoMemoryEnabled
    );
  }

  get intervalMs(): number {
    return this.config.intervalMs;
  }

  /** Whether an automatic dream should run now. */
  async isDreamDue(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    const state = await this.loadState();
    if (Date.now() - state.lastDreamAt < this.config.intervalMs) {
      return false;
    }

    const memories = await this.deps.memoryStore.load();
    if (!this.deps.consciousness.shouldReflect(memories, state.processedLogs.length)) {
      return false;
    }

    const pending = await this.findPendingLogs(state);
    return pending.length > 0;
  }

  /**
   * Run one dream cycle. `force` bypasses the interval/reflection gate for
   * manual triggers and the startup scan, but still skips when no new logs
   * exist, so a waking-up Obsidian costs nothing when there is nothing to do.
   */
  async runDream(force = false): Promise<DreamRunResult> {
    if (!this.enabled) {
      return emptyResult('disabled');
    }
    if (this.running) {
      return emptyResult('already-running');
    }
    this.running = true;

    try {
      const state = await this.loadState();
      const pendingLogs = await this.findPendingLogs(state);
      if (pendingLogs.length === 0) {
        return emptyResult('no-new-logs');
      }

      const sanitized = await this.consolidate(state, pendingLogs);
      return await this.persist(state, sanitized, pendingLogs);
    } catch (error) {
      return {
        ...emptyResult('failed'),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.running = false;
    }
  }

  private async consolidate(
    state: DreamState,
    logPaths: string[],
  ): Promise<DreamMemoryResult> {
    const logsText = (await Promise.all(
      logPaths.map(async path => {
        try {
          return await this.deps.adapter.read(path);
        } catch {
          return '';
        }
      }),
    )).join('\n');

    const memories = await this.deps.memoryStore.load();
    const existingText = formatMemoryAppendix(memories);
    const profileText = (await this.deps.consciousness.getUserProfile()) ?? '';

    const cap = this.config.inputCharCap;
    const logsCapped = sliceToChars(logsText, Math.floor(cap * 0.6));
    const existingCapped = sliceToChars(existingText, Math.floor(cap * 0.25));
    const profileCapped = sliceToChars(profileText, Math.floor(cap * 0.15));

    const context = this.deps.getConversationContext?.() ?? null;
    const providerId = context?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    const runner = this.deps.createRunner(providerId);
    try {
      const response = await runner.query(
        { systemPrompt: DREAM_MEMORY_SYSTEM_PROMPT, model: context?.model ?? undefined },
        buildDreamPrompt({
          logs: logsCapped,
          existingMemories: existingCapped,
          userProfile: profileCapped,
        }),
      );

      const parsed = parseDreamMemoryResponse(response);
      return sanitizeDreamResult(parsed, {
        maxNewFacts: this.config.maxNewFacts,
        maxProfileUpdates: this.config.maxProfileUpdates,
        maxInsights: this.config.maxInsights,
      });
    } finally {
      runner.reset();
    }
  }

  private async persist(
    state: DreamState,
    result: DreamMemoryResult,
    processedLogs: string[],
  ): Promise<DreamRunResult> {
    // Phase 2.5: write new facts through MemoryStore so its dedupe applies.
    const memories = await this.deps.memoryStore.load();
    const existingContents = new Set<string>(
      memories.map(entry => normalizeContent(entry.content)),
    );
    let newFacts = 0;
    for (const fact of result.newFacts) {
      const key = normalizeContent(fact.content);
      if (existingContents.has(key)) {
        continue;
      }
      existingContents.add(key);
      await this.deps.memoryStore.add({
        category: fact.category,
        content: fact.content,
        source: 'user-implicit',
      });
      newFacts += 1;
    }

    // Profile updates are implicit extraction and obey its privacy gate.
    let profileUpdates = 0;
    if (this.deps.consciousness.privacyConfig.allowImplicitExtraction) {
      for (const update of result.profileUpdates) {
        await this.deps.consciousness.updateUserProfile(update.section, update.content);
        profileUpdates += 1;
      }
    }

    const awareness = await this.deps.consciousness.getAwarenessState(memories);
    const journalPath = await this.writeDreamJournal(result, awareness);
    await this.saveState({
      lastDreamAt: Date.now(),
      processedLogs: dedupe([
        ...state.processedLogs,
        ...processedLogs.map(path => path.split('/').pop() ?? path),
      ]),
    });
    await this.deps.consciousness.logActivity(
      'consolidation',
      `Dream consolidation: ${newFacts} fact(s), ${profileUpdates} profile update(s), ${result.insights.length} insight(s)`,
    );

    return {
      ran: true,
      newFacts,
      profileUpdates,
      insights: result.insights.length,
      journalPath,
    };
  }

  private async writeDreamJournal(
    result: DreamMemoryResult,
    awareness: AwarenessState,
  ): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const filePath = `${DREAM_DIR}/${today}.md`;

    const lines: string[] = [
      `## ${new Date().toISOString()}`,
      '',
      `> Memories: ${awareness.totalMemories} | Confidence: ${awareness.confidenceLevel} | Insights: ${awareness.insightCount}`,
      '',
    ];
    if (result.newFacts.length > 0) {
      lines.push('### New long-term memories', '');
      for (const fact of result.newFacts) {
        lines.push(`- [${fact.category}] ${fact.content}`);
      }
      lines.push('');
    }
    if (result.profileUpdates.length > 0) {
      lines.push('### Profile updates', '');
      for (const update of result.profileUpdates) {
        lines.push(`- [${update.section}] ${update.content}`);
      }
      lines.push('');
    }
    if (result.insights.length > 0) {
      lines.push('### Insights', '');
      for (const insight of result.insights) {
        lines.push(`- ${insight.content}`);
      }
      lines.push('');
    }
    lines.push('---', '');

    await this.deps.adapter.append(filePath, lines.join('\n'));
    return filePath;
  }

  private async findPendingLogs(state: DreamState): Promise<string[]> {
    const processed = new Set(state.processedLogs);
    const cutoff = Date.now() - this.config.maxLogDays * 24 * 60 * 60 * 1000;
    const candidates = [
      ...await this.deps.adapter.listFilesRecursive(SHORT_TERM_DIR),
      ...await this.deps.adapter.listFilesRecursive(LEGACY_SHORT_TERM_DIR),
    ];

    return [...new Set(candidates)].filter(path => {
      const basename = path.split('/').pop() ?? '';
      if (!isDatedLog(basename)) {
        return false;
      }
      if (processed.has(basename)) {
        return false;
      }
      const fileTime = new Date(basename.slice(0, 10)).getTime();
      return Number.isFinite(fileTime) && fileTime >= cutoff;
    }).sort();
  }

  private async loadState(): Promise<DreamState> {
    try {
      const content = await this.deps.adapter.read(DREAM_STATE_FILE);
      const parsed = JSON.parse(content) as Partial<DreamState>;
      return {
        lastDreamAt: typeof parsed.lastDreamAt === 'number' ? parsed.lastDreamAt : 0,
        processedLogs: Array.isArray(parsed.processedLogs)
          ? parsed.processedLogs.filter((log): log is string => typeof log === 'string')
          : [],
      };
    } catch {
      return { lastDreamAt: 0, processedLogs: [] };
    }
  }

  private async saveState(state: DreamState): Promise<void> {
    const kept = dedupe(state.processedLogs).slice(-MAX_STATE_PROCESSED_LOGS);
    await this.deps.adapter.write(
      DREAM_STATE_FILE,
      JSON.stringify({ lastDreamAt: state.lastDreamAt, processedLogs: kept }, null, 2),
    );
  }
}

function emptyResult(reason: NonNullable<DreamRunResult['reason']>): DreamRunResult {
  return { ran: false, reason, newFacts: 0, profileUpdates: 0, insights: 0 };
}

function sliceToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
