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
import { type AwarenessState, LEGACY_SHORT_TERM_DIR, SHORT_TERM_DIR } from './consciousness-types';
import type { ConsciousnessEngine } from './ConsciousnessEngine';
import { isMemoryDuplicate } from './deduplication';
import { formatMemoryAppendix } from './memoryPrompt';
import type { MemoryStore } from './MemoryStore';
import type { MindStore } from './MindStore';

/** Dream journal and state location under the vault. */
export const DREAM_DIR = '.claudian-plus/awareness/dreams';
export const DREAM_STATE_FILE = `${DREAM_DIR}/state.json`;

/** Bound the processed-log ledger so it cannot grow without limit. */
const MAX_STATE_PROCESSED_LOGS = 400;
/** Check interval for the periodic dream trigger (matches vault review cadence). */
export const DREAM_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/**
 * Max wall-clock time for one dream model call. A hung provider subprocess
 * must not block consolidation (and the `running` lock) indefinitely.
 */
const DREAM_QUERY_TIMEOUT_MS = 120_000;

interface DreamState {
  lastDreamAt: number;
  /** Basenames processed at least once (legacy ledger; see processedFingerprints). */
  processedLogs: string[];
  /**
   * Per-file fingerprint (`mtime:size`) captured when the file was processed.
   * A log appended after processing has a different fingerprint, so it is
   * picked up by the next dream instead of being skipped forever.
   */
  processedFingerprints: Record<string, string>;
}

/** A pending log file with the fingerprint captured before its content is read. */
interface ProcessedLogEntry {
  path: string;
  fingerprint: string | null;
}

interface DreamServiceConfig {
  /** Minimum interval between automatic dreams in ms. */
  intervalMs?: number;
  /** How many recent days of logs to consider. */
  maxLogDays?: number;
  /** Input character budget for one dream. */
  inputCharCap?: number;
  maxNewFacts?: number;
  maxProfileUpdates?: number;
  maxInsights?: number;
  /** Max wall-clock time for one dream model call before it is aborted. */
  queryTimeoutMs?: number;
}

interface DreamRunResult {
  ran: boolean;
  reason?: 'disabled' | 'already-running' | 'no-new-logs' | 'failed';
  error?: string;
  newFacts: number;
  profileUpdates: number;
  insights: number;
  journalPath?: string;
}

interface DreamServiceDependencies {
  adapter: VaultFileAdapter;
  memoryStore: MemoryStore;
  mindStore?: MindStore;
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
  queryTimeoutMs: DREAM_QUERY_TIMEOUT_MS,
};

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

      const sanitized = await this.consolidate(
        state,
        pendingLogs.map(entry => entry.path),
      );
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
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(
      () => abortController.abort(),
      this.config.queryTimeoutMs,
    );
    try {
      const response = await runner.query(
        {
          systemPrompt: DREAM_MEMORY_SYSTEM_PROMPT,
          model: context?.model ?? undefined,
          abortController,
        },
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
      window.clearTimeout(timeoutId);
      runner.reset();
    }
  }

  private async persist(
    state: DreamState,
    result: DreamMemoryResult,
    processedLogs: ProcessedLogEntry[],
  ): Promise<DreamRunResult> {
    // Phase 2.5: write new facts through MemoryStore so its dedupe applies.
    const memories = await this.deps.memoryStore.load();
    const durableMindRules = (await this.deps.mindStore?.listDurable()) ?? [];
    const allExisting: Array<string | { content: string }> = [...memories, ...durableMindRules];

    let newFacts = 0;
    for (const fact of result.newFacts) {
      if (isMemoryDuplicate(fact.content, allExisting)) {
        continue;
      }
      allExisting.push(fact.content);
      await this.deps.memoryStore.add({
        category: fact.category,
        content: fact.content,
        source: 'user-implicit',
      });
      newFacts += 1;
    }

    // Insights are durable meta-observations; persist them under their own
    // category, deduped against everything already written this cycle.
    let insights = 0;
    for (const insight of result.insights) {
      if (isMemoryDuplicate(insight.content, allExisting)) {
        continue;
      }
      allExisting.push(insight.content);
      await this.deps.memoryStore.add({
        category: 'Insights',
        content: insight.content,
        source: 'user-implicit',
      });
      insights += 1;
    }

    // Profile updates are implicit extraction and obey its privacy gate.
    // They share the dedupe set so a fact and a profile update stating the
    // same thing are never written twice.
    let profileUpdates = 0;
    if (this.deps.consciousness.privacyConfig.allowImplicitExtraction) {
      for (const update of result.profileUpdates) {
        if (isMemoryDuplicate(update.content, allExisting)) {
          continue;
        }
        allExisting.push(update.content);
        await this.deps.consciousness.updateUserProfile(update.section, update.content);
        profileUpdates += 1;
      }
    }

    const awareness = await this.deps.consciousness.getAwarenessState(memories);
    const journalPath = await this.writeDreamJournal(result, awareness);

    // Only logs that did not change while the model call ran count as
    // consumed. A log appended mid-dream was only partially distilled;
    // leaving it out of both the ledger and the fingerprints lets the next
    // dream consolidate the appended content (the legacy process-once path
    // keys off `processedLogs`, so it must stay in sync with fingerprints).
    const retained: ProcessedLogEntry[] = [];
    for (const entry of processedLogs) {
      if (entry.fingerprint) {
        const current = await this.statFingerprint(entry.path);
        if (current === entry.fingerprint) {
          retained.push(entry);
        }
      } else {
        retained.push(entry);
      }
    }

    const fingerprints: Record<string, string> = {};
    for (const entry of retained) {
      if (entry.fingerprint) {
        fingerprints[entry.path.split('/').pop() ?? entry.path] = entry.fingerprint;
      }
    }
    await this.saveState({
      lastDreamAt: Date.now(),
      processedLogs: dedupe([
        ...state.processedLogs,
        ...retained.map(entry => entry.path.split('/').pop() ?? entry.path),
      ]),
      processedFingerprints: {
        ...state.processedFingerprints,
        ...fingerprints,
      },
    });
    await this.deps.consciousness.logActivity(
      'consolidation',
      `Dream consolidation: ${newFacts} fact(s), ${profileUpdates} profile update(s), ${insights} insight(s)`,
    );

    return {
      ran: true,
      newFacts,
      profileUpdates,
      insights,
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
      `> Memories: ${awareness.totalMemories} | Confidence: ${awareness.confidenceLevel} | Insights: ${result.insights.length}`,
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

  /**
   * Fingerprint of a log file (`mtime:size`). Null when stat fails, in which
   * case the file is treated as pending once and never re-checked.
   */
  private async statFingerprint(path: string): Promise<string | null> {
    try {
      const stat = await this.deps.adapter.stat(path);
      if (!stat) {
        return null;
      }
      return `${stat.mtime}:${stat.size}`;
    } catch {
      return null;
    }
  }

  private async findPendingLogs(state: DreamState): Promise<ProcessedLogEntry[]> {
    const legacyProcessed = new Set(state.processedLogs);
    const cutoff = Date.now() - this.config.maxLogDays * 24 * 60 * 60 * 1000;
    const candidates = [
      ...await this.deps.adapter.listFilesRecursive(SHORT_TERM_DIR),
      ...await this.deps.adapter.listFilesRecursive(LEGACY_SHORT_TERM_DIR),
    ];

    const pending: ProcessedLogEntry[] = [];
    for (const path of [...new Set(candidates)]) {
      const basename = path.split('/').pop() ?? '';
      if (!isDatedLog(basename)) {
        continue;
      }
      const fileTime = new Date(basename.slice(0, 10)).getTime();
      if (!Number.isFinite(fileTime) || fileTime < cutoff) {
        continue;
      }

      const fingerprint = await this.statFingerprint(path);
      const recorded = state.processedFingerprints[basename];
      if (recorded !== undefined && recorded === fingerprint) {
        continue;
      }
      // Pre-fingerprint ledger entries: process once and never re-check, so
      // the upgrade keeps old behavior for files we cannot re-verify.
      if (recorded === undefined && legacyProcessed.has(basename)) {
        continue;
      }
      pending.push({ path, fingerprint });
    }
    return pending.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async loadState(): Promise<DreamState> {
    try {
      const content = await this.deps.adapter.read(DREAM_STATE_FILE);
      const parsed = JSON.parse(content) as Partial<DreamState>;
      const fingerprints: Record<string, string> = {};
      if (parsed.processedFingerprints && typeof parsed.processedFingerprints === 'object') {
        for (const [name, fingerprint] of Object.entries(parsed.processedFingerprints)) {
          if (typeof fingerprint === 'string' && fingerprint) {
            fingerprints[name] = fingerprint;
          }
        }
      }
      return {
        lastDreamAt: typeof parsed.lastDreamAt === 'number' ? parsed.lastDreamAt : 0,
        processedLogs: Array.isArray(parsed.processedLogs)
          ? parsed.processedLogs.filter((log): log is string => typeof log === 'string')
          : [],
        processedFingerprints: fingerprints,
      };
    } catch {
      return { lastDreamAt: 0, processedLogs: [], processedFingerprints: {} };
    }
  }

  private async saveState(state: DreamState): Promise<void> {
    const kept = dedupe(state.processedLogs).slice(-MAX_STATE_PROCESSED_LOGS);
    const fingerprints: Record<string, string> = {};
    for (const name of kept) {
      const fingerprint = state.processedFingerprints[name];
      if (fingerprint) {
        fingerprints[name] = fingerprint;
      }
    }
    await this.deps.adapter.write(
      DREAM_STATE_FILE,
      JSON.stringify({
        lastDreamAt: state.lastDreamAt,
        processedLogs: kept,
        processedFingerprints: fingerprints,
      }, null, 2),
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
