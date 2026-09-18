/**
 * Policy and budget for automatic background model requests (R1).
 *
 * The policy distinguishes the explicit `standard` / `economy` saving modes.
 * In economy mode automatic background tasks (AI titles, micro-dreams,
 * scheduled dreams) must not issue model requests; user-triggered operations
 * never consult this policy, so chat, inline edit, and manual actions always
 * run. The decision is applied at the automatic-task scheduling boundary —
 * never inside a runner, so a blocked task degrades quietly instead of
 * producing an error.
 */

import type { AuxiliarySavingMode } from '../types/settings';

export type { AuxiliarySavingMode };

/** Automatic (unsupervised) background tasks that may issue model requests. */
export type AutomaticAuxiliaryTask = 'auto-title' | 'auto-micro-dream' | 'auto-dream';

/** Why a background request was not issued. `null` from `tryBegin` means issued. */
export type BackgroundRequestRejection = 'cancelled' | 'busy' | 'daily-limit-reached';

/** Saving-mode decision plus the shared daily budget, consumed at scheduling boundaries. */
export interface BackgroundRequestGate {
  allowsAutomaticTask(task: AutomaticAuxiliaryTask): boolean;
  /** Reserve the slot and count the request; `null` when issued. */
  tryBegin(signal?: AbortSignal): BackgroundRequestRejection | null;
  /** Release the slot acquired by a successful `tryBegin`. */
  end(): void;
}

/** Persisted per-day usage so the daily count survives a plugin restart. */
export interface BackgroundRequestUsageSnapshot {
  day: string;
  count: number;
}

/** Resolves the configured saving mode. Unknown values must resolve to `standard`. */
export function resolveAuxiliarySavingMode(raw: unknown): AuxiliarySavingMode {
  return raw === 'economy' ? 'economy' : 'standard';
}

/** Pure saving-mode decision. Manual, user-triggered operations bypass it entirely. */
export class AuxiliaryRequestPolicy {
  constructor(private readonly savingMode: AuxiliarySavingMode) {}

  get mode(): AuxiliarySavingMode {
    return this.savingMode;
  }

  /** Whether the automatic task may issue background model requests. */
  allowsAutomaticTask(_task: AutomaticAuxiliaryTask): boolean {
    return this.savingMode !== 'economy';
  }
}

const LOCAL_TITLE_MAX_CHARS = 50;

/**
 * Local title built from the first non-empty message line, used when an
 * automatic title request is not issued. Deterministic and model-free.
 */
export function buildLocalFallbackTitle(userMessage: string): string {
  const firstLine = userMessage
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0);
  if (!firstLine) {
    return 'Untitled';
  }
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= LOCAL_TITLE_MAX_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, LOCAL_TITLE_MAX_CHARS)}...`;
}

export interface AuxiliaryRequestGateOptions {
  resolveSavingMode: () => AuxiliarySavingMode;
  /** Daily cap for automatic background requests. `null` means unlimited. */
  resolveDailyLimit: () => number | null;
  /** Usage restored from persisted settings; ignored unless it is for today. */
  initialUsage?: unknown;
  onUsageChanged?: (usage: BackgroundRequestUsageSnapshot) => void;
  now?: () => Date;
}

/**
 * Shared gate across all background tasks: saving-mode policy plus one daily
 * budget with a single concurrency slot. One instance lives on the plugin and
 * is handed to every automatic-task scheduling boundary, so the per-day count
 * is shared and survives a restart through settings persistence.
 */
export class AuxiliaryRequestGate implements BackgroundRequestGate {
  private readonly resolveSavingMode: () => AuxiliarySavingMode;
  private readonly resolveDailyLimit: () => number | null;
  private readonly onUsageChanged?: (usage: BackgroundRequestUsageSnapshot) => void;
  private readonly now: () => Date;
  private dayKey: string;
  private issuedToday = 0;
  private inFlight = 0;

  constructor(options: AuxiliaryRequestGateOptions) {
    this.resolveSavingMode = options.resolveSavingMode;
    this.resolveDailyLimit = options.resolveDailyLimit;
    this.onUsageChanged = options.onUsageChanged;
    this.now = options.now ?? (() => new Date());
    this.dayKey = formatLocalDayKey(this.now());
    const restored = sanitizeUsage(options.initialUsage, this.dayKey);
    this.issuedToday = restored.count;
  }

  /** Pure saving-mode decision for an automatic task. */
  allowsAutomaticTask(task: AutomaticAuxiliaryTask): boolean {
    return new AuxiliaryRequestPolicy(
      resolveAuxiliarySavingMode(this.resolveSavingMode()),
    ).allowsAutomaticTask(task);
  }

  /**
   * Reserve the concurrency slot and count one background request. Returns
   * `null` when the request is issued (and counted); otherwise the rejection
   * reason. A request aborted before dispatch is not counted; one that fails
   * after dispatch stays counted.
   */
  tryBegin(signal?: AbortSignal): BackgroundRequestRejection | null {
    this.rollDayIfNeeded();
    if (signal?.aborted) {
      return 'cancelled';
    }
    if (this.inFlight > 0) {
      return 'busy';
    }
    const limit = this.resolveDailyLimit();
    if (limit !== null && this.issuedToday >= limit) {
      return 'daily-limit-reached';
    }
    this.issuedToday += 1;
    this.inFlight += 1;
    this.persist();
    return null;
  }

  /** Release the concurrency slot acquired by a successful `tryBegin`. */
  end(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  getIssuedToday(): number {
    this.rollDayIfNeeded();
    return this.issuedToday;
  }

  getInFlightCount(): number {
    return this.inFlight;
  }

  getUsageSnapshot(): BackgroundRequestUsageSnapshot {
    this.rollDayIfNeeded();
    return { day: this.dayKey, count: this.issuedToday };
  }

  private rollDayIfNeeded(): void {
    const key = formatLocalDayKey(this.now());
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.issuedToday = 0;
    }
  }

  private persist(): void {
    if (!this.onUsageChanged) {
      return;
    }
    try {
      this.onUsageChanged(this.getUsageSnapshot());
    } catch {
      // Persistence is best-effort; the request is already issued and counted.
    }
  }
}

function formatLocalDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function sanitizeUsage(raw: unknown, todayKey: string): BackgroundRequestUsageSnapshot {
  if (!raw || typeof raw !== 'object') {
    return { day: todayKey, count: 0 };
  }
  const candidate = raw as { day?: unknown; count?: unknown };
  if (candidate.day !== todayKey || typeof candidate.count !== 'number') {
    return { day: todayKey, count: 0 };
  }
  if (!Number.isSafeInteger(candidate.count) || candidate.count < 0) {
    return { day: todayKey, count: 0 };
  }
  return { day: todayKey, count: candidate.count };
}

let sharedBackgroundRequestGate: AuxiliaryRequestGate | null = null;

/**
 * Assembly hook for services that are constructed inside provider modules and
 * cannot receive the plugin-owned gate (the query-backed title service is
 * created by each provider registration). The plugin sets this during onload;
 * an unset gate means "no saving mode configured", preserving old behavior.
 */
export function setSharedBackgroundRequestGate(gate: AuxiliaryRequestGate | null): void {
  sharedBackgroundRequestGate = gate;
}

export function getSharedBackgroundRequestGate(): AuxiliaryRequestGate | null {
  return sharedBackgroundRequestGate;
}
