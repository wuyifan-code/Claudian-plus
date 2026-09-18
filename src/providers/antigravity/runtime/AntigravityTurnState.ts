import type { StreamChunk } from '../../../core/types';
import {
  type AntigravityEventNormalizationState,
  type AntigravityResultInfo,
  classifyAntigravityEvent,
  createAntigravityEventNormalizationState,
  normalizeAntigravityEvent,
  readAntigravityInit,
  readAntigravityResult,
  readAntigravityStepUpdate,
} from '../normalizations/antigravityEventNormalization';

export type AntigravityTurnPhase =
  | 'idle'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed';

export type AntigravityProcessPhase = 'idle' | 'spawning' | 'active' | 'exited';

export type AntigravitySettlementSource = 'result' | 'stream-end' | 'spawn-error' | 'guard';

export type AntigravitySettlementReason =
  | 'success'
  | 'error-result'
  | 'cancelled-result'
  | 'unknown-status'
  | 'malformed-result'
  | 'incomplete-result'
  | 'timeout'
  | 'cancelled'
  | 'exit-failure'
  | 'spawn-failed'
  | 'session-mismatch';

export interface AntigravityTurnSettlement {
  phase: 'completed' | 'failed';
  source: AntigravitySettlementSource;
  reason: AntigravitySettlementReason;
  detail?: string;
}

export interface AntigravityProcessExitInfo {
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
}

export interface AntigravityTurnBeginOptions {
  expectedSessionId?: string;
}

export interface AntigravityTurnIngestResult {
  chunks: StreamChunk[];
  /** True when the event was dropped (before begin, after settlement, or foreign session). */
  suppressed: boolean;
  settlement: AntigravityTurnSettlement | null;
}

/**
 * Single-turn state machine for one Antigravity CLI invocation. Instances are single-turn by
 * design: a settled state rejects both new events and a second beginTurn, so late output from a
 * finished turn can never land in the next one — the next turn gets a fresh instance.
 *
 * Process state (spawning/active/exited) is tracked separately from turn state. Process exit
 * alone never settles the turn: stdout lines may still drain after exit, so settlement waits for
 * markStreamEnd and merges both signals, settling done/error exactly once.
 */
export class AntigravityTurnState {
  private readonly turnIndexValue: number;
  private readonly normalizationStateValue: AntigravityEventNormalizationState;
  private turnPhaseValue: AntigravityTurnPhase = 'idle';
  private processPhaseValue: AntigravityProcessPhase = 'idle';
  private settlementValue: AntigravityTurnSettlement | null = null;
  private expectedSessionId: string | null = null;
  private exitInfoValue: AntigravityProcessExitInfo | null = null;
  private timedOut = false;
  private cancelRequestedValue = false;
  private unknownEventCountValue = 0;
  private sessionMismatchCountValue = 0;

  constructor(turnIndex: number) {
    this.turnIndexValue = turnIndex;
    this.normalizationStateValue = createAntigravityEventNormalizationState({ turnIndex });
  }

  get turnIndex(): number {
    return this.turnIndexValue;
  }

  get phase(): AntigravityTurnPhase {
    return this.turnPhaseValue;
  }

  get processPhase(): AntigravityProcessPhase {
    return this.processPhaseValue;
  }

  get settlement(): AntigravityTurnSettlement | null {
    return this.settlementValue;
  }

  get boundSessionId(): string | null {
    return this.normalizationStateValue.boundSessionId;
  }

  get assistantText(): string {
    return this.normalizationStateValue.accumulatedText;
  }

  get cancelRequested(): boolean {
    return this.cancelRequestedValue;
  }

  get unknownEventCount(): number {
    return this.unknownEventCountValue;
  }

  get sessionMismatchCount(): number {
    return this.sessionMismatchCountValue;
  }

  get responseMismatchCount(): number {
    return this.normalizationStateValue.responseMismatchCount;
  }

  get duplicateToolResultCount(): number {
    return this.normalizationStateValue.duplicateToolResultCount;
  }

  /** Raw normalization state, for replay consumers that need the full per-turn record. */
  getEventNormalizationState(): AntigravityEventNormalizationState {
    return this.normalizationStateValue;
  }

  beginTurn(options?: AntigravityTurnBeginOptions): void {
    if (this.turnPhaseValue !== 'idle') {
      throw new Error('Antigravity turn state has already begun and cannot be reused.');
    }
    this.expectedSessionId = options?.expectedSessionId ?? null;
    this.turnPhaseValue = 'starting';
  }

  markProcessSpawning(): void {
    if (this.processPhaseValue === 'idle') {
      this.processPhaseValue = 'spawning';
    }
  }

  markProcessActive(): void {
    if (this.processPhaseValue === 'idle' || this.processPhaseValue === 'spawning') {
      this.processPhaseValue = 'active';
    }
  }

  markProcessSpawnError(detail: string): AntigravityTurnSettlement {
    this.processPhaseValue = 'exited';
    return this.settle('failed', 'spawn-error', 'spawn-failed', detail);
  }

  markProcessExit(info: AntigravityProcessExitInfo): void {
    this.processPhaseValue = 'exited';
    this.exitInfoValue = info;
    if (info.timedOut) {
      this.timedOut = true;
    }
    // No settlement here: drained stdout lines can still follow the exit callback.
  }

  markTimedOut(): void {
    this.timedOut = true;
  }

  markStreamEnd(): AntigravityTurnSettlement | null {
    if (this.settlementValue) {
      return null;
    }
    return this.settleFromProcessSignals();
  }

  /**
   * Requests cancellation of the in-flight turn. This never settles by itself: with no known
   * in-protocol cancel control, the turn settles when the killed process's stream ends — unless
   * a terminal result races in first.
   */
  requestCancel(): boolean {
    if (this.settlementValue || this.turnPhaseValue === 'idle') {
      return false;
    }
    this.cancelRequestedValue = true;
    this.turnPhaseValue = 'cancelling';
    return true;
  }

  ingest(record: Record<string, unknown>): AntigravityTurnIngestResult {
    if (this.turnPhaseValue === 'idle' || this.settlementValue) {
      return { chunks: [], suppressed: true, settlement: null };
    }

    const kind = classifyAntigravityEvent(record);
    if (kind === 'unknown') {
      this.unknownEventCountValue += 1;
      return { chunks: [], suppressed: false, settlement: null };
    }

    this.activate();
    if (kind === 'init') {
      return this.ingestInit(record);
    }
    if (kind === 'step_update') {
      return this.ingestStepUpdate(record);
    }
    return this.ingestResult(record);
  }

  private ingestInit(record: Record<string, unknown>): AntigravityTurnIngestResult {
    const info = readAntigravityInit(record);
    const chunks = normalizeAntigravityEvent(record, this.normalizationStateValue);
    if (
      info
      && info.conversationId
      && this.expectedSessionId
      && info.conversationId !== this.expectedSessionId
    ) {
      this.sessionMismatchCountValue += 1;
      return {
        chunks,
        suppressed: false,
        settlement: this.settle('failed', 'guard', 'session-mismatch'),
      };
    }
    return { chunks, suppressed: false, settlement: null };
  }

  private ingestStepUpdate(record: Record<string, unknown>): AntigravityTurnIngestResult {
    const info = readAntigravityStepUpdate(record);
    if (info && this.isForeignSession(info.conversationId)) {
      this.sessionMismatchCountValue += 1;
      return { chunks: [], suppressed: true, settlement: null };
    }
    const chunks = normalizeAntigravityEvent(record, this.normalizationStateValue);
    return { chunks, suppressed: false, settlement: null };
  }

  private ingestResult(record: Record<string, unknown>): AntigravityTurnIngestResult {
    const info = readAntigravityResult(record);
    if (!info) {
      const chunks = normalizeAntigravityEvent(record, this.normalizationStateValue);
      return {
        chunks,
        suppressed: false,
        settlement: this.settle('failed', 'result', 'malformed-result'),
      };
    }
    if (this.isForeignSession(info.conversationId)) {
      this.sessionMismatchCountValue += 1;
      return {
        chunks: [],
        suppressed: true,
        settlement: this.settle('failed', 'guard', 'session-mismatch'),
      };
    }
    const chunks = normalizeAntigravityEvent(record, this.normalizationStateValue);
    return { chunks, suppressed: false, settlement: this.settleFromResult(info) };
  }

  private isForeignSession(conversationId: string): boolean {
    return Boolean(
      conversationId
      && this.normalizationStateValue.boundSessionId
      && conversationId !== this.normalizationStateValue.boundSessionId,
    ) || Boolean(
      conversationId
      && this.expectedSessionId
      && this.normalizationStateValue.boundSessionId === null
      && conversationId !== this.expectedSessionId,
    );
  }

  private activate(): void {
    if (this.turnPhaseValue === 'starting') {
      this.turnPhaseValue = 'running';
    }
  }

  private settleFromResult(info: AntigravityResultInfo): AntigravityTurnSettlement {
    switch (info.normalizedStatus) {
      case 'success':
        return this.settle('completed', 'result', 'success');
      case 'error':
        return this.settle('failed', 'result', 'error-result', info.error ?? undefined);
      case 'cancelled':
      case 'interrupted':
        return this.settle('failed', 'result', 'cancelled-result', `status ${info.status}`);
      default:
        return this.settle('failed', 'result', 'unknown-status', `status ${info.status}`);
    }
  }

  private settleFromProcessSignals(): AntigravityTurnSettlement {
    if (this.timedOut || this.exitInfoValue?.timedOut) {
      return this.settle('failed', 'stream-end', 'timeout');
    }
    if (this.exitInfoValue?.killed && this.cancelRequestedValue) {
      return this.settle('failed', 'stream-end', 'cancelled');
    }
    const exitCode = this.exitInfoValue?.exitCode;
    if (typeof exitCode === 'number' && exitCode !== 0) {
      return this.settle('failed', 'stream-end', 'exit-failure', `exit code ${exitCode}`);
    }
    return this.settle('failed', 'stream-end', 'incomplete-result');
  }

  private settle(
    phase: 'completed' | 'failed',
    source: AntigravitySettlementSource,
    reason: AntigravitySettlementReason,
    detail?: string,
  ): AntigravityTurnSettlement {
    if (!this.settlementValue) {
      this.settlementValue = {
        phase,
        source,
        reason,
        ...(detail !== undefined ? { detail } : {}),
      };
      this.turnPhaseValue = phase;
    }
    return this.settlementValue;
  }
}
