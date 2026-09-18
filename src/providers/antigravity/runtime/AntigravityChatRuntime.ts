import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  SlashCommand,
  StreamChunk,
} from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  AntigravityConversationHistoryService,
  type AntigravityHistoryAvailability,
  type AntigravityTurnSettledInput,
  type AntigravityTurnStartInput,
} from '../history/AntigravityConversationHistoryService';
import { AntigravityHistoryStore } from '../history/AntigravityHistoryStore';
import type { AntigravityFailureCategory } from '../lastFailure';
import { toAntigravityRuntimeModelId } from '../models';
import { getAntigravityProviderSettings, recordAntigravityLastFailure } from '../settings';
import {
  ANTIGRAVITY_PROVIDER_CAPABILITIES,
  ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
  type AntigravitySessionState,
  readAntigravitySessionState,
  writeAntigravitySessionState,
} from '../types';
import { AntigravityCliResolver } from './AntigravityCliResolver';
import { AntigravityJsonlLimitError, parseAntigravityJsonlStream } from './AntigravityJsonl';
import {
  ANTIGRAVITY_PROVIDER_ID,
  AntigravityCliMissingError,
  type AntigravityLaunchSpec,
  AntigravityLaunchSpecError,
  buildAntigravityLaunchSpec,
  requireAntigravityCliPath,
} from './AntigravityLaunchSpec';
import {
  AntigravitySubprocess,
  type AntigravitySubprocessLaunchSpec,
} from './AntigravitySubprocess';
import { type AntigravityTurnSettlement,AntigravityTurnState } from './AntigravityTurnState';
import { buildAntigravityPrompt } from './buildAntigravityPrompt';

export class AntigravityProviderDisabledError extends Error {
  constructor() {
    super('Antigravity provider is disabled. Enable it in provider settings to start chatting.');
    this.name = 'AntigravityProviderDisabledError';
  }
}

/**
 * The process surface the runtime needs from the shared SubprocessRunner.
 * `AntigravitySubprocess` satisfies this structurally; tests inject fakes.
 */
export interface AntigravitySubprocessHandle {
  readonly stdout: AsyncIterable<Uint8Array>;
  start(): void;
  isAlive(): boolean;
  getStderrSnapshot(): string;
  onClose(listener: (error?: Error) => void): () => void;
  onExit(callback: (code: number | null, signal: string | null) => void): void;
  shutdown(): Promise<void>;
}

export type AntigravitySubprocessFactory = (spec: AntigravitySubprocessLaunchSpec) => AntigravitySubprocessHandle;

export interface AntigravityChatRuntimeOptions {
  /** Overrides CLI resolution (settings path → PATH lookup); returning null means "missing". */
  resolveCliPath?: () => Promise<string | null> | string | null;
  /** Overrides subprocess construction; production default is `AntigravitySubprocess`. */
  createSubprocess?: AntigravitySubprocessFactory;
  /**
   * Replay-cache port. `createAntigravityChatRuntime` supplies the real A4
   * history service; without it the runtime still runs turns but records no
   * replay history, so the bare constructor is only for offline tests.
   */
  historyService?: AntigravityHistoryRecorder;
  /** Overrides the vault path used for the replay cache; defaults to the vault adapter path. */
  resolveVaultPath?: () => string | null;
}

/**
 * The slice of the A4 history service the runtime drives, plus the cache cursor
 * it needs to keep appending after a restart.
 *
 * `recordTurnStart` / `recordTurnSettled` / `describeHistoryAvailability` mirror
 * `AntigravityConversationHistoryService` exactly. `resolveNextTurnIndex` is not
 * part of that service: turn indices group replay records inside the cache, so a
 * restarted runtime must continue after the highest index already recorded
 * instead of reusing index 0 and replacing the first turn's records.
 */
export interface AntigravityHistoryRecorder {
  describeHistoryAvailability(
    conversation: Conversation,
    vaultPath: string | null,
  ): Promise<AntigravityHistoryAvailability>;
  recordTurnStart(
    conversation: Conversation,
    vaultPath: string | null,
    input: AntigravityTurnStartInput,
  ): Promise<void>;
  recordTurnSettled(
    conversation: Conversation,
    vaultPath: string | null,
    input: AntigravityTurnSettledInput,
  ): Promise<void>;
  resolveNextTurnIndex(conversation: Conversation, vaultPath: string | null): Promise<number>;
}

/** Test seams only; the replay-cache recorder is always supplied by the factory. */
export type AntigravityRuntimeOverrides = Omit<AntigravityChatRuntimeOptions, 'historyService'>;

interface ActiveAntigravityTurn {
  cancelled: boolean;
  queue: AntigravityChunkQueue;
  runtime: AntigravityTurnState;
  subprocess: AntigravitySubprocessHandle | null;
  unregisterClose: (() => void) | null;
  watchdog: number | null;
  history: AntigravityTurnHistoryContext;
}

interface AntigravityTurnHistoryContext {
  /** Normalized chunks received for this turn, in stream order. */
  chunks: StreamChunk[];
  /** Cache turn index, resolved from the replay cache before dispatch; 0 until then. */
  turnIndex: number;
  /** The user request, stored so replay shows what was asked. */
  userText: string;
  /**
   * Whether the request was written to the cache before dispatch. Turns that
   * start without a bound session can only be recorded once the CLI's own init
   * has bound one, and `recordTurnSettled` preserves an existing user record.
   */
  startRecorded: boolean;
}

/**
 * Bounded StreamChunk queue bridging the pump (subprocess drain) and the
 * `query` async generator; mirrors the shared runtime queue pattern.
 */
class AntigravityChunkQueue {
  private closed = false;
  private readonly items: StreamChunk[] = [];
  private readonly waiters: Array<(chunk: StreamChunk | null) => void> = [];

  push(chunk: StreamChunk): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
      return;
    }
    this.items.push(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(null);
    }
  }

  async next(): Promise<StreamChunk | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    return new Promise<StreamChunk | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/**
 * Per-turn print-mode runtime for the Antigravity CLI (the only A0-verified
 * invocation shape). One runtime instance is bound to one tab/session:
 *
 * - every turn spawns its own `agy -p … [--conversation <id>]` process, so a
 *   second concurrent `query()` on the same instance is rejected explicitly
 *   instead of interleaving process writes or session state;
 * - `cancel` has no in-protocol control (A0), so it terminates the process and
 *   the next turn resumes the CLI-side conversation through the verified
 *   explicit `--conversation <id>` path — never `-c`/`--continue`;
 * - session state is written only through the typed helpers in `../types`;
 * - every turn is recorded in the provider-owned replay cache (request before dispatch, settled
 *   output before `done`), so a restart replays user text, assistant text, and tool activity in
 *   order; partial history — a bound CLI session whose cache is missing — is reported as a notice
 *   instead of silently re-sending the transcript;
 * - there is no interactive approval channel in headless print mode: approval
 *   callbacks are accepted as no-ops, the CLI's native permission policy
 *   governs tool execution, denials surface as tool-result errors, and no
 *   permission-bypass flag is ever added to fix "tools cannot run";
 * - `cleanup` is idempotent and never leaves an orphan agy process.
 */
export class AntigravityChatRuntime implements ChatRuntime {
  readonly providerId = ANTIGRAVITY_PROVIDER_ID;

  private readonly cliResolver = new AntigravityCliResolver();
  private readonly options: AntigravityChatRuntimeOptions;
  private readonly plugin: ProviderHost;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private readonly history: AntigravityHistoryRecorder | null;

  private activeTurn: ActiveAntigravityTurn | null = null;
  private confirmedSessionState: AntigravitySessionState | null = null;
  private conversationGeneration = 0;
  private conversationKey: string | null = null;
  private currentConversationModel: string | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private disposed = false;
  private historyConversationBase: Conversation | null = null;
  private nextTurnIndex = 1;
  private ready = false;
  private sessionInvalidated = false;

  constructor(plugin: ProviderHost, options: AntigravityChatRuntimeOptions = {}) {
    this.plugin = plugin;
    this.options = options;
    this.history = options.historyService ?? null;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return ANTIGRAVITY_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    // Antigravity has no verified compact command; /compact text would be sent
    // to the model verbatim, so it is never treated as a control command.
    return {
      isCompact: false,
      mcpMentions: new Set<string>(),
      persistedContent: '',
      prompt: buildAntigravityPrompt(request),
      request,
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(conversation: ChatRuntimeConversationState | null, _externalContextPaths?: string[]): void {
    const key = conversation?.id ?? null;
    if (key !== this.conversationKey) {
      this.conversationGeneration += 1;
      this.conversationKey = key;
      this.currentConversationModel = conversation?.selectedModel ?? null;
      this.confirmedSessionState = this.readPersistedSessionState(conversation);
    } else {
      this.currentConversationModel = conversation?.selectedModel ?? null;
    }
    // Rebuilt on every sync so the history view follows the freshly persisted
    // provider state instead of a stale snapshot.
    this.historyConversationBase = buildAntigravityHistoryConversation(conversation);
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    try {
      await this.ensureReadyOrThrow();
      return true;
    } catch {
      return false;
    }
  }

  async *query(
    turn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (this.disposed) {
      yield { type: 'error', content: 'Antigravity runtime was cleaned up; reload the tab to continue.' };
      yield { type: 'done' };
      return;
    }
    if (this.activeTurn) {
      yield {
        type: 'error',
        content: 'An Antigravity turn is already in progress in this tab. Stop the current turn before starting another.',
      };
      yield { type: 'done' };
      return;
    }

    const generation = this.conversationGeneration;
    this.currentTurnMetadata = {};
    // The active turn is registered before any await so a cancel() racing the
    // preparation phase still reaches it.
    const turnIndex = this.nextTurnIndex;
    const turnState = new AntigravityTurnState(turnIndex);
    this.nextTurnIndex = turnIndex + 1;
    turnState.beginTurn({ expectedSessionId: this.confirmedSessionState?.conversationId ?? undefined });
    const active: ActiveAntigravityTurn = {
      cancelled: false,
      queue: new AntigravityChunkQueue(),
      runtime: turnState,
      subprocess: null,
      unregisterClose: null,
      watchdog: null,
      history: {
        chunks: [],
        turnIndex: 0,
        userText: turn.request.text,
        startRecorded: false,
      },
    };
    this.activeTurn = active;

    const pump = (async () => {
      let cliPath: string;
      try {
        cliPath = await this.ensureReadyOrThrow();
      } catch (error) {
        this.setReady(false);
        await this.recordStartupFailureFromError(error);
        active.queue.push({ type: 'error', content: error instanceof Error ? error.message : String(error) });
        active.queue.push({ type: 'done' });
        active.queue.close();
        return;
      }
      if (active.cancelled) {
        // cancel() during preparation already queued the terminal notice+done.
        return;
      }
      await this.runTurn(active, turn, cliPath, queryOptions, generation);
    })();

    try {
      while (true) {
        const chunk = await active.queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
      }
      await pump;
    } finally {
      // A consumer abandoning the generator (break/return) must not leave the
      // turn's process running; a normally finished pump has already settled.
      if (this.activeTurn === active) {
        this.activeTurn = null;
        this.clearWatchdog(active);
        active.unregisterClose?.();
        active.queue.close();
        if (!turnState.settlement && !active.cancelled) {
          active.cancelled = true;
          void active.subprocess?.shutdown().catch(() => {});
        }
      }
    }
  }

  cancel(): void {
    const active = this.activeTurn;
    if (!active) {
      return;
    }
    active.cancelled = true;
    this.clearWatchdog(active);
    if (active.subprocess) {
      if (active.runtime.requestCancel()) {
        active.queue.push({
          type: 'notice',
          content: 'Antigravity turn cancelled; stopping the CLI process. The next turn resumes the same conversation.',
          level: 'warning',
        });
      }
      void active.subprocess.shutdown().catch(() => {});
      return;
    }
    // Cancel during preparation: no process exists, so end the pending wait now.
    if (active.runtime.requestCancel()) {
      active.queue.push({
        type: 'notice',
        content: 'Antigravity turn cancelled before the CLI process started.',
        level: 'warning',
      });
    }
    active.queue.push({ type: 'done' });
    active.queue.close();
  }

  resetSession(): void {
    this.conversationGeneration += 1;
    this.confirmedSessionState = null;
    this.sessionInvalidated = true;
    if (this.activeTurn) {
      this.cancel();
    }
  }

  getSessionId(): string | null {
    return this.confirmedSessionState?.conversationId ?? null;
  }

  consumeSessionInvalidation(): boolean {
    const invalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return invalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    // No provider commands are verified for headless agy (capabilities report
    // supportsProviderCommands: false); the feature layer hides the command UI.
    return [];
  }

  cleanup(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancel();
    this.readyListeners.clear();
    this.setReady(false);
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string | undefined,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}
  setApprovalDismisser(_dismisser: (() => void) | null): void {}
  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}
  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}
  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {}
  setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const updates: Partial<Conversation> = {};
    const conversation = params.conversation;
    const isBoundConversation = conversation !== null && conversation.id === this.conversationKey;

    if (conversation && isBoundConversation && this.confirmedSessionState) {
      // providerState is written only through the typed helper, which merges
      // with (never clobbers) unrelated provider-owned keys.
      updates.providerState = writeAntigravitySessionState(conversation, this.confirmedSessionState);
      updates.sessionId = this.confirmedSessionState.conversationId;
    } else if (conversation && params.sessionInvalidated && !this.confirmedSessionState) {
      updates.providerState = undefined;
      updates.sessionId = null;
    }
    return { updates };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.confirmedSessionState?.conversationId
      ?? readAntigravitySessionState(conversation)?.conversationId
      ?? conversation?.sessionId
      ?? null;
  }

  private readPersistedSessionState(conversation: ChatRuntimeConversationState | null): AntigravitySessionState | null {
    if (!conversation) {
      return null;
    }
    // The runtime conversation view carries exactly the field the reader needs
    // (providerState); the helper reads nothing else.
    return readAntigravitySessionState(conversation as Conversation);
  }

  private async ensureReadyOrThrow(): Promise<string> {
    if (this.disposed) {
      throw new Error('Antigravity runtime was cleaned up; reload the tab to continue.');
    }
    const settings = getAntigravityProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      this.setReady(false);
      throw new AntigravityProviderDisabledError();
    }
    const resolved = this.options.resolveCliPath
      ? await this.options.resolveCliPath()
      : this.cliResolver.resolveFromSettings(this.plugin.settings);
    const cliPath = requireAntigravityCliPath(resolved);
    this.setReady(true);
    return cliPath;
  }

  private resolveRuntimeModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    const selected = queryOptions?.model ?? this.currentConversationModel ?? null;
    if (!selected || !selected.trim()) {
      return null;
    }
    return toAntigravityRuntimeModelId(selected.trim()) || null;
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }
    this.ready = ready;
    for (const listener of [...this.readyListeners]) {
      listener(ready);
    }
  }

  private clearWatchdog(active: ActiveAntigravityTurn): void {
    if (active.watchdog !== null) {
      window.clearTimeout(active.watchdog);
      active.watchdog = null;
    }
  }

  private async runTurn(
    active: ActiveAntigravityTurn,
    turn: PreparedChatTurn,
    cliPath: string,
    queryOptions: ChatRuntimeQueryOptions | undefined,
    generation: number,
  ): Promise<void> {
    const { queue, runtime: turnState } = active;
    try {
      const settings = getAntigravityProviderSettings(this.plugin.settings);
      if (!settings.enabled) {
        this.setReady(false);
        queue.push({ type: 'error', content: new AntigravityProviderDisabledError().message });
        return;
      }
      if (active.cancelled) {
        // Cancel raced the preparation; cancel() already closed the queue.
        return;
      }
      if (generation !== this.conversationGeneration) {
        throw new Error('Antigravity conversation changed before the turn started.');
      }

      // History is written before the CLI process exists: the user is told when
      // local bodies are unavailable, and the request is durable even if the
      // process dies mid-turn. Neither step may ever re-encode earlier
      // messages into the prompt.
      await this.reportHistoryAvailability(active);
      await this.recordTurnStart(active);
      if (active.cancelled) {
        // Cancel raced the history writes; cancel() already closed the queue.
        return;
      }

      const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...parseEnvironmentVariables(settings.environmentVariables),
      };
      const launchSpec: AntigravityLaunchSpec = buildAntigravityLaunchSpec({
        command: cliPath,
        cwd,
        prompt: turn.prompt,
        conversationId: this.confirmedSessionState?.conversationId ?? null,
        model: this.resolveRuntimeModelId(queryOptions),
        printTimeout: `${Math.max(1, Math.ceil(settings.timeoutMs / 1000))}s`,
        env,
      });
      const subprocess = this.createSubprocess({
        args: launchSpec.args,
        command: launchSpec.command,
        cwd: launchSpec.cwd,
        env: launchSpec.env,
      });
      active.subprocess = subprocess;
      turnState.markProcessSpawning();

      let exitCode: number | null = null;
      let startError: Error | null = null;
      let sawRecords = false;
      let watchdogFired = false;
      const exitPromise = new Promise<void>((resolve) => {
        subprocess.onExit((code) => {
          exitCode = code;
          resolve();
        });
      });
      const unregisterClose = subprocess.onClose((error) => {
        if (error && !startError) {
          startError = error;
        }
      });
      active.unregisterClose = unregisterClose;
      subprocess.start();
      turnState.markProcessActive();

      // Outer watchdog: the CLI enforces its own --print-timeout; this bounds a
      // hung process from the plugin side and is cleared on settlement/cancel.
      active.watchdog = window.setTimeout(() => {
        active.watchdog = null;
        watchdogFired = true;
        turnState.markTimedOut();
        void subprocess.shutdown().catch(() => {});
      }, settings.timeoutMs);

      const drainPromise = (async () => {
        try {
          for await (const record of parseAntigravityJsonlStream(subprocess.stdout)) {
            sawRecords = true;
            if (record.kind === 'parsed') {
              this.ingestTurnRecord(active, record.parsed);
            } else {
              queue.push({
                type: 'notice',
                content: `Antigravity sent an output line that is not valid JSON: ${record.error}`,
                level: 'warning',
              });
            }
            if (turnState.settlement) {
              break;
            }
          }
        } catch (error) {
          if (error instanceof AntigravityJsonlLimitError) {
            queue.push({
              type: 'error',
              content: `Antigravity output exceeded a stream limit: ${error.message}`,
            });
          } else {
            queue.push({
              type: 'error',
              content: `Antigravity output stream failed: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
          void subprocess.shutdown().catch(() => {});
        }
      })();

      await exitPromise;
      await drainPromise;
      this.clearWatchdog(active);
      unregisterClose();

      // Assigned from subprocess callbacks; local flow analysis cannot see
      // those assignments across the awaits, so read them through widened views.
      const startFailure = startError as Error | null;
      const observedExitCode = exitCode as number | null;

      if (!turnState.settlement) {
        if (startFailure && !sawRecords && !active.cancelled && !watchdogFired) {
          // Close fired with an error before any stdout record and without a
          // cancel or watchdog in flight: the CLI never started.
          turnState.markProcessSpawnError(startFailure.message);
        } else {
          turnState.markProcessExit({
            exitCode: observedExitCode,
            timedOut: watchdogFired,
            killed: active.cancelled,
          });
        }
      }

      const settlement = turnState.markStreamEnd() ?? turnState.settlement;
      await this.finishTurn(active, settlement, generation);
    } catch (error) {
      this.clearWatchdog(active);
      await this.recordStartupFailureFromError(error);
      const message = error instanceof Error ? error.message : String(error);
      queue.push({ type: 'error', content: `Antigravity turn failed: ${message}` });
      this.setReady(false);
      queue.push({ type: 'done' });
      queue.close();
    }
  }

  private ingestTurnRecord(active: ActiveAntigravityTurn, record: Record<string, unknown>): void {
    const result = active.runtime.ingest(record);
    for (const chunk of result.chunks) {
      // Chunks kept for the replay cache; the history service filters the ones
      // that are message bodies (usage, notices and done markers are not).
      active.history.chunks.push(chunk);
      active.queue.push(chunk);
    }
  }

  private async finishTurn(
    active: ActiveAntigravityTurn,
    settlement: AntigravityTurnSettlement | null,
    generation: number,
  ): Promise<void> {
    const { queue, runtime: turnState } = active;
    this.clearWatchdog(active);

    if (settlement && settlement.phase === 'failed' && RUNTIME_FAILURE_REASONS.has(settlement.reason)) {
      // Result-level failures were already surfaced by the normalization layer;
      // these are process-level failures the runtime must report itself.
      queue.push({
        type: 'error',
        content: describeAntigravitySettlement(settlement, active.subprocess?.getStderrSnapshot() ?? ''),
      });
    }

    this.recordSessionStateAfterTurn(turnState, settlement, generation);
    this.currentTurnMetadata.wasSent = true;
    if (settlement?.phase === 'failed') {
      this.setReady(false);
      await this.recordStartupFailureForSettlement(turnState, settlement);
    }
    // The turn is only reported as done once its replay records are durable, so
    // a restart immediately after the last chunk still replays the turn.
    await this.recordTurnSettled(active, generation);
    queue.push({ type: 'done' });
    queue.close();
  }

  /**
   * Persists the latest failure category for the settings tab. Diagnostics are
   * best-effort by contract: a recording failure (a rejected settings write, a
   * read-only vault) is swallowed, because losing a diagnostic must never fail
   * or delay a turn's real outcome.
   */
  private async recordStartupFailure(
    category: AntigravityFailureCategory,
    detail?: string,
  ): Promise<void> {
    try {
      await this.plugin.mutateSettings((settings) => {
        recordAntigravityLastFailure(
          settings,
          category,
          detail,
        );
      });
    } catch {
      // Never surfaced: the user already sees the turn-level error chunk.
    }
  }

  private async recordStartupFailureFromError(error: unknown): Promise<void> {
    if (error instanceof AntigravityCliMissingError) {
      await this.recordStartupFailure('cli-missing');
      return;
    }
    if (error instanceof AntigravityLaunchSpecError) {
      // The process was never launched; only the error name is recorded so no
      // launch value (which may embed a path) reaches settings.
      await this.recordStartupFailure('spawn-failed', error.name);
    }
  }

  private async recordStartupFailureForSettlement(
    turnState: AntigravityTurnState,
    settlement: AntigravityTurnSettlement,
  ): Promise<void> {
    const category = classifyAntigravityStartupFailure(settlement, turnState.boundSessionId);
    if (!category) {
      return;
    }
    await this.recordStartupFailure(category, settlement.detail);
  }

  private async reportHistoryAvailability(active: ActiveAntigravityTurn): Promise<void> {
    const history = this.history;
    const conversation = this.buildHistoryConversation();
    if (!history || !conversation) {
      return;
    }
    let availability: AntigravityHistoryAvailability;
    try {
      availability = await history.describeHistoryAvailability(conversation, this.resolveVaultPath());
    } catch {
      // Availability is diagnostic only; a failed probe never blocks the turn.
      return;
    }
    if (!availability.partialHistory) {
      return;
    }
    active.queue.push({
      type: 'notice',
      level: 'warning',
      content:
        'Antigravity history for this conversation is partial: the CLI conversation is still bound, '
        + 'but its local replay cache is missing, so earlier messages cannot be shown. The turn continues '
        + 'in the bound CLI conversation, and the earlier transcript is not re-sent.',
    });
  }

  private async recordTurnStart(active: ActiveAntigravityTurn): Promise<void> {
    const history = this.history;
    const conversation = this.buildHistoryConversation();
    if (!history || !conversation || !active.history.userText) {
      return;
    }
    try {
      active.history.turnIndex = await history.resolveNextTurnIndex(conversation, this.resolveVaultPath());
      if (!hasBoundAntigravitySession(conversation)) {
        // The cache is keyed by the CLI's conversation id, which does not exist
        // yet on the first turn of a session; the settle path records the
        // request together with the assistant output once init has bound it.
        return;
      }
      await history.recordTurnStart(conversation, this.resolveVaultPath(), {
        turnIndex: active.history.turnIndex,
        userText: active.history.userText,
      });
      active.history.startRecorded = true;
    } catch {
      // Pre-dispatch durability is best-effort; the turn must still run.
    }
  }

  private async recordTurnSettled(active: ActiveAntigravityTurn, generation: number): Promise<void> {
    const history = this.history;
    if (!history || generation !== this.conversationGeneration) {
      // The tab switched conversations mid-turn; the stale turn's output belongs
      // to another conversation and must not enter this conversation's cache.
      return;
    }
    const conversation = this.buildHistoryConversation();
    if (!conversation || !hasBoundAntigravitySession(conversation)) {
      return;
    }
    const vaultPath = this.resolveVaultPath();
    try {
      if (!active.history.startRecorded && active.history.userText) {
        await history.recordTurnStart(conversation, vaultPath, {
          turnIndex: active.history.turnIndex,
          userText: active.history.userText,
        });
      }
      await history.recordTurnSettled(conversation, vaultPath, {
        turnIndex: active.history.turnIndex,
        chunks: [...active.history.chunks],
      });
    } catch (error) {
      // A failed cache write must not fail the turn, but it is never silent:
      // the next restart will show less history than the user saw.
      active.queue.push({
        type: 'notice',
        level: 'warning',
        content: 'Antigravity could not save this turn to the local replay cache; it may be missing after a '
          + `restart (${error instanceof Error ? error.message : String(error)}).`,
      });
    }
  }

  private resolveVaultPath(): string | null {
    return this.options.resolveVaultPath
      ? this.options.resolveVaultPath()
      : getVaultPath(this.plugin.app);
  }

  /**
   * Conversation view handed to the replay-cache API: the synced conversation
   * identity plus the session binding confirmed so far, so cache records are
   * keyed by the CLI's own conversation id.
   */
  private buildHistoryConversation(): Conversation | null {
    const base = this.historyConversationBase;
    if (!base) {
      return null;
    }
    const target: Conversation = { ...base };
    if (this.confirmedSessionState) {
      writeAntigravitySessionState(target, this.confirmedSessionState);
    }
    return target;
  }

  private recordSessionStateAfterTurn(
    turnState: AntigravityTurnState,
    settlement: AntigravityTurnSettlement | null,
    generation: number,
  ): void {
    if (generation !== this.conversationGeneration) {
      // The tab switched conversations mid-turn; the stale turn must not touch
      // the new conversation's session state.
      return;
    }
    const boundId = turnState.boundSessionId;
    if (!boundId) {
      return;
    }
    const prior = this.confirmedSessionState;
    if (settlement?.phase === 'completed') {
      const priorCount = prior && prior.conversationId === boundId ? prior.turnCount : 0;
      this.confirmedSessionState = {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: boundId,
        turnCount: priorCount + 1,
      };
      return;
    }
    if (!prior || prior.conversationId !== boundId) {
      // A real conversation id was bound by the CLI's own init (A0-verified
      // echo behavior), so it is safe to resume even though the turn failed —
      // cancelled turns persist partial CLI-side history. Turn counts are only
      // advanced by settled successful turns.
      this.confirmedSessionState = {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: boundId,
        turnCount: 0,
      };
    }
  }

  private createSubprocess(spec: AntigravitySubprocessLaunchSpec): AntigravitySubprocessHandle {
    if (this.options.createSubprocess) {
      return this.options.createSubprocess(spec);
    }
    return new AntigravitySubprocess(spec);
  }
}

/**
 * Builds the runtime the provider module serves: the A4 replay cache is wired
 * here, so registration only needs the plugin and never the history service.
 *
 * `overrides` exists for offline tests that replace CLI resolution and process
 * construction; the replay recorder itself is never overridable.
 */
export function createAntigravityChatRuntime(
  plugin: ProviderHost,
  overrides: AntigravityRuntimeOverrides = {},
): AntigravityChatRuntime {
  const historyService = new AntigravityConversationHistoryService();
  const historyStore = new AntigravityHistoryStore();
  return new AntigravityChatRuntime(plugin, {
    ...overrides,
    historyService: {
      describeHistoryAvailability: (conversation, vaultPath) =>
        historyService.describeHistoryAvailability(conversation, vaultPath),
      recordTurnStart: (conversation, vaultPath, input) =>
        historyService.recordTurnStart(conversation, vaultPath, input),
      recordTurnSettled: (conversation, vaultPath, input) =>
        historyService.recordTurnSettled(conversation, vaultPath, input),
      /**
       * Cache turn indices group replay records and survive restarts, so the
       * runtime continues after the highest index already on disk instead of
       * reusing index 0 and replacing an earlier turn. Only the store's public
       * read API is used; the record format stays owned by the history module.
       */
      resolveNextTurnIndex: async (conversation, vaultPath) => {
        const conversationId = historyService.resolveSessionIdForConversation(conversation);
        if (!conversationId) {
          return 0;
        }
        const records = await historyStore.readRecords(vaultPath, conversationId);
        return records.reduce((next, record) => Math.max(next, record.turnIndex + 1), 0);
      },
    },
  });
}

/**
 * Conversation view for the replay cache. Only the fields the history service
 * reads are meaningful; the provider's own session binding is layered on top by
 * `buildHistoryConversation`.
 */
function buildAntigravityHistoryConversation(
  conversation: ChatRuntimeConversationState | null,
): Conversation | null {
  const id = conversation?.id;
  if (typeof id !== 'string' || !id) {
    return null;
  }
  const providerState = conversation?.providerState;
  return {
    id,
    providerId: ANTIGRAVITY_PROVIDER_ID,
    title: '',
    createdAt: 0,
    updatedAt: 0,
    sessionId: conversation?.sessionId ?? null,
    messages: [],
    ...(providerState ? { providerState: { ...providerState } } : {}),
  };
}

/** Whether a conversation carries a conversation id the CLI can be resumed with. */
function hasBoundAntigravitySession(conversation: Conversation): boolean {
  const bound = readAntigravitySessionState(conversation)?.conversationId
    ?? conversation.sessionId?.trim();
  return Boolean(bound);
}

/**
 * Failure reasons the normalization layer does not surface as its own error
 * chunk; the runtime adds the terminal error message for exactly these.
 */
const RUNTIME_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'spawn-failed',
  'timeout',
  'incomplete-result',
  'exit-failure',
  'session-mismatch',
]);

/**
 * Maps a failed turn's settlement onto the startup failure the settings tab
 * shows. Model-level and user-caused outcomes (an error result the CLI
 * reported, a cancel) are not startup failures and record nothing; a failure
 * before the CLI bound a conversation is an init failure, and after that it is
 * a stream the plugin could not use.
 */
function classifyAntigravityStartupFailure(
  settlement: AntigravityTurnSettlement,
  boundSessionId: string | null,
): AntigravityFailureCategory | null {
  switch (settlement.reason) {
    case 'spawn-failed':
      return 'spawn-failed';
    case 'timeout':
      return 'timeout';
    case 'session-mismatch':
      return 'init-failed';
    case 'malformed-result':
      return 'malformed-stream';
    case 'incomplete-result':
    case 'exit-failure':
    case 'unknown-status':
      return boundSessionId ? 'malformed-stream' : 'init-failed';
    default:
      return null;
  }
}

function describeAntigravitySettlement(settlement: AntigravityTurnSettlement, stderrSnapshot: string): string {
  const detailSuffix = settlement.detail ? `: ${settlement.detail}` : '';
  let message: string;
  switch (settlement.reason) {
    case 'spawn-failed':
      message = `Antigravity CLI could not be started${detailSuffix}`;
      break;
    case 'timeout':
      message = 'Antigravity turn timed out before the CLI produced a result.';
      break;
    case 'session-mismatch':
      message = 'Antigravity reported events for a different conversation; the turn was rejected to avoid cross-talk.';
      break;
    case 'incomplete-result':
      message = 'Antigravity exited without a result event; the turn is incomplete.';
      break;
    case 'exit-failure':
      message = `Antigravity CLI exited with a failure${detailSuffix}`;
      break;
    default:
      message = `Antigravity turn failed (${settlement.reason})${detailSuffix}`;
      break;
  }
  const stderr = stderrSnapshot.trim();
  return stderr ? `${message}\nCLI stderr: ${stderr}` : message;
}
