import { randomUUID } from 'node:crypto';

import { formatAmbientContextXml } from '../../../core/context/ambientFormatter';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
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
import type { ChatMessage, Conversation, SlashCommand, StreamChunk } from '../../../core/types';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import { appendCurrentNote } from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';
import { getVaultPath } from '../../../utils/path';
import { dshProviderCapabilities } from '../capabilities';
import { decodeDshModelId, DSH_DEFAULT_MODEL_ID } from '../models';
import { DshStreamNormalizer, isDshObject, readDshEvent } from '../normalization/dshRecords';
import { getDshProviderSettings } from '../settings';
import type { DshEventHandler, DshEventOutcome, DshHost, DshHostLease } from './DshHost';

interface NativeBinding {
  schemaVersion: 1;
  backend: 'native';
  home: string;
  preset?: string;
}

interface ActiveQuery {
  closed: boolean;
  chunks: StreamChunk[];
  wake?: () => void;
  snapshotReady: Promise<void>;
  resolveSnapshot: () => void;
  close: (error?: Error) => void;
}

function canonicalHome(home: string): string {
  const trimmed = home.replace(/[\\/]+$/, '');
  return /^[a-z]:[\\/]|^\\\\/i.test(home) ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed;
}

function bindingFor(value: unknown): NativeBinding | null {
  if (!isDshObject(value) || value.schemaVersion !== 1 || value.backend !== 'native'
    || typeof value.home !== 'string' || !value.home.trim()
    || (value.preset !== undefined && typeof value.preset !== 'string')) return null;
  return { schemaVersion: 1, backend: 'native', home: value.home, ...(typeof value.preset === 'string' ? { preset: value.preset } : {}) };
}

/** One tab's native session lease; the workspace Host owns process and event routing. */
export class DshChatRuntime implements ChatRuntime {
  readonly providerId = 'dsh' as const;
  private lease?: DshHostLease;
  private sessionId: string | null = null;
  private binding: NativeBinding | null = null;
  private bindingError: string | null = null;
  private selectedModel: string | null = null;
  private ownsClaim = false;
  private disposed = false;
  private ready = false;
  private generation = 0;
  private readiness?: Promise<boolean>;
  private active?: ActiveQuery;
  private metadata: ChatTurnMetadata = {};
  private approvalCallback: ApprovalCallback | null = null;
  private approvalDismisser: (() => void) | null = null;
  private readonly readyListeners = new Set<(ready: boolean) => void>();

  constructor(
    private readonly plugin: ProviderHost,
    private readonly host: DshHost,
    private readonly resolveVaultPath: () => string | null = () => getVaultPath(plugin.app),
  ) {}

  getCapabilities() { return dshProviderCapabilities; }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    let prompt = request.text;
    if (request.currentNotePath) prompt = appendCurrentNote(prompt, request.currentNotePath);
    if (request.editorSelection && request.editorSelection.mode !== 'none') prompt = appendEditorContext(prompt, request.editorSelection);
    if (request.browserSelection) prompt = appendBrowserContext(prompt, request.browserSelection);
    if (request.canvasSelection) prompt = appendCanvasContext(prompt, request.canvasSelection);
    if (request.ambientContext) {
      const context = formatAmbientContextXml(request.ambientContext, request.ambientBudgets);
      if (context) prompt += `\n\n${context}`;
    }
    return { request, persistedContent: request.text, prompt, isCompact: false, mcpMentions: new Set() };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => { this.readyListeners.delete(listener); };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(conversation: ChatRuntimeConversationState | null): void {
    this.selectedModel = conversation?.selectedModel ?? null;
    const sessionId = conversation?.sessionId ?? null;
    const binding = bindingFor(conversation?.providerState);
    const bindingError = sessionId && !binding
      ? 'This legacy DeepSeek/ACP conversation cannot attach to the native Harness. Keep its history and start a new DeepSeek conversation.' : null;
    if (sessionId === this.sessionId && JSON.stringify(binding) === JSON.stringify(this.binding) && bindingError === this.bindingError) return;
    this.generation++;
    this.active?.close(new Error('DeepSeek conversation changed. Native work was left running.'));
    this.releaseLease();
    this.sessionId = sessionId;
    this.binding = binding;
    this.bindingError = bindingError;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    if (this.disposed) return false;
    if (this.bindingError) throw new Error(this.bindingError);
    if (this.ready && (this.sessionId || options?.allowSessionCreation === false)) return true;
    if (this.readiness) return this.readiness;
    const generation = this.generation;
    const readiness = this.initialize(generation, options?.allowSessionCreation !== false);
    this.readiness = readiness;
    try { return await readiness; }
    finally { if (this.readiness === readiness) this.readiness = undefined; }
  }

  private async initialize(generation: number, allowSessionCreation: boolean): Promise<boolean> {
    const lease = this.lease ?? await this.host.acquire();
    if (this.disposed || this.generation !== generation) { lease.release(); return false; }
    this.lease = lease;
    if (this.binding && canonicalHome(this.binding.home) !== canonicalHome(lease.home)) {
      throw new Error('DeepSeek conversation belongs to another native home. Restore that home to continue this session.');
    }
    if (this.binding?.preset !== undefined && this.binding.preset !== 'claudian-plus') {
      throw new Error('DeepSeek conversation belongs to another agent preset. Restore its original provider configuration.');
    }
    await lease.ready();
    if (this.disposed || this.generation !== generation) return false;
    if (!this.sessionId && allowSessionCreation) {
      const cwd = this.resolveVaultPath();
      if (!cwd) throw new Error('The vault filesystem path is unavailable for DeepSeek Harness.');
      const created = await lease.client.call<unknown>('session/create', { request: { cwd, agentPreset: 'claudian-plus' } });
      if (!isDshObject(created) || typeof created.sessionId !== 'string' || !created.sessionId
        || (created.agentPreset !== undefined && created.agentPreset !== 'claudian-plus')) {
        throw new Error('DeepSeek returned an invalid native session binding.');
      }
      if (this.disposed || this.generation !== generation) return false;
      this.sessionId = created.sessionId;
      this.binding = { schemaVersion: 1, backend: 'native', home: lease.home, preset: 'claudian-plus' };
    }
    if (this.sessionId && !this.ownsClaim) {
      lease.claim(this.sessionId, request => this.handleInteraction(request));
      this.ownsClaim = true;
    }
    this.setReady(true);
    return true;
  }

  async *query(turn: PreparedChatTurn, _history: ChatMessage[] = [], options?: ChatRuntimeQueryOptions): AsyncGenerator<StreamChunk> {
    if (this.active) { yield { type: 'error', content: 'DeepSeek already has an active query in this tab.' }; yield { type: 'done' }; return; }
    let resolveSnapshot = () => {};
    const active: ActiveQuery = {
      closed: false, chunks: [], snapshotReady: new Promise<void>(resolve => { resolveSnapshot = resolve; }),
      resolveSnapshot: () => resolveSnapshot(),
      close: error => {
        if (active.closed) return;
        if (error) active.chunks.push({ type: 'error', content: error.message });
        active.closed = true;
        active.resolveSnapshot();
        active.wake?.();
      },
    };
    this.active = active;
    this.metadata = { wasSent: false };
    let unsubscribe = () => {};
    let offDisconnect = () => {};
    let timer: number | undefined;
    try {
      if (turn.request.images?.length) throw new Error('DeepSeek native image attachments are not supported by this integration.');
      const ready = await this.ensureReady();
      if (active.closed) { yield* active.chunks.splice(0); yield { type: 'done' }; return; }
      if (!ready || !this.lease || !this.sessionId) throw new Error('DeepSeek Harness is unavailable.');
      const lease = this.lease;
      const sessionId = this.sessionId;
      await lease.ready();
      await this.selectModel(options?.model);
      if (active.closed) { yield* active.chunks.splice(0); yield { type: 'done' }; return; }
      const requestId = randomUUID();
      const normalizer = new DshStreamNormalizer();
      let snapshotSeen = false;
      let ownTurn: number | null = null;
      offDisconnect = lease.client.onDisconnect(() => {
        this.setReady(false);
        active.close(new Error('DeepSeek connection was lost. Native work may still be running; use Stop after reconnecting if needed.'));
      });
      timer = window.setTimeout(() => active.close(new Error('DeepSeek follow snapshot timed out. Native work was not cancelled.')), getDshProviderSettings(this.plugin.settings).startupTimeoutMs);
      unsubscribe = lease.client.subscribe('session/follow', { args: { request: { address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 50 } } }, value => {
        if (active.closed) return;
        try {
          if (!snapshotSeen) {
            if (!isDshObject(value) || value.type !== 'snapshot' || !isDshObject(value.header) || value.header.id !== sessionId
              || !Number.isSafeInteger(value.cursor) || (value.cursor as number) < -1 || !Array.isArray(value.records)) {
              throw new Error('DeepSeek follow did not open with the expected native session snapshot.');
            }
            snapshotSeen = true;
            normalizer.accept(value);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => active.close(new Error('DeepSeek live turn timed out. Native work may still be running.')), 10 * 60_000);
            active.resolveSnapshot();
            return;
          }
          if (isDshObject(value) && value.type === 'snapshot') throw new Error('DeepSeek unexpectedly replaced the live follow baseline.');
          if (isDshObject(value) && value.type === 'invalidated') throw new Error('DeepSeek invalidated its live stream. Reopen this conversation to load native history.');
          const event = readDshEvent(value);
          const chunks = normalizer.accept(value);
          if (normalizer.latestRequestId === requestId && ownTurn === null && normalizer.activeTurn !== null) {
            ownTurn = normalizer.activeTurn;
            this.metadata.wasSent = true;
            if (event?.type === 'user/message' && typeof event.data.id === 'string') this.metadata.userMessageId = event.data.id;
          }
          if (normalizer.invalidated) {
            for (const chunk of chunks) active.chunks.push(chunk);
            active.close();
          } else if (ownTurn !== null && normalizer.activeTurn === ownTurn) {
            active.chunks.push(...chunks);
            if (event?.type === 'assistant/message' && isDshObject(event.data.message) && typeof event.data.message.id === 'string') {
              this.metadata.assistantMessageId = event.data.message.id;
            }
            if (normalizer.endedTurn === ownTurn) active.close();
          }
          active.wake?.();
        } catch (error) { active.close(error instanceof Error ? error : new Error('Invalid DeepSeek live record.')); }
      }, error => { this.setReady(false); active.close(error); }, undefined, () => active.close(new Error('DeepSeek live follow ended before the requested turn completed.')));
      await active.snapshotReady;
      if (!active.closed) {
        const responseFormat = this.plugin.getResponseFormatInjectionText?.() ?? Promise.resolve(null);
        const additions = (await Promise.all([this.plugin.getMemoryInjectionText(turn.prompt), this.plugin.getConsciousnessInjectionText(), responseFormat])).filter((value): value is string => !!value?.trim());
        const prompt = additions.length ? `<system_context>\n${additions.join('\n\n')}\n</system_context>\n\n${turn.prompt}` : turn.prompt;
        if (!active.closed) await lease.client.call('session/prompt', { request: { sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: prompt }] } });
      }
      while (active.chunks.length || !active.closed) {
        const chunk = active.chunks.shift();
        if (chunk) yield chunk;
        else await new Promise<void>(resolve => { active.wake = resolve; });
      }
    } catch (error) {
      active.close(error instanceof Error ? error : new Error('DeepSeek native query failed.'));
      for (const chunk of active.chunks.splice(0)) yield chunk;
    } finally {
      window.clearTimeout(timer);
      unsubscribe();
      offDisconnect();
      if (this.active === active) this.active = undefined;
    }
    yield { type: 'done' };
  }

  private async selectModel(override?: string): Promise<void> {
    const settings = this.plugin.settings;
    const config = getDshProviderSettings(settings);
    const selected = override ?? this.selectedModel ?? (typeof settings.model === 'string' && settings.model.startsWith('dsh/') ? settings.model : null) ?? config.selectedModel ?? DSH_DEFAULT_MODEL_ID;
    if (selected === DSH_DEFAULT_MODEL_ID) return;
    const model = decodeDshModelId(selected);
    const catalog = model && config.models.find(candidate => candidate.provider === model.provider && candidate.model === model.model);
    if (!model || !catalog) throw new Error('The selected DeepSeek model is absent from the native catalog. Refresh models and select an available model.');
    const effort = typeof settings.effortLevel === 'string' ? settings.effortLevel : '';
    if (effort && !catalog.reasoning?.includes(effort)) throw new Error('The selected DeepSeek reasoning effort is unavailable for this native model.');
    await this.lease!.client.call('session/selectModel', { request: { sessionId: this.sessionId, ...model, ...(effort ? { reasoningEffort: effort } : {}) } });
  }

  private async handleInteraction({ event, request, signal }: Parameters<DshEventHandler>[0]): Promise<DshEventOutcome> {
    if (event !== 'approval/request') return { kind: 'next' };
    const rejected = { kind: 'result', value: 'rejected' } as const;
    // YOLO mirrors Codex's approvalPolicy: 'never' — the user explicitly opted
    // this tab out of approval gates, so the request resolves before any UI
    // exists to dismiss.
    if (this.isYoloMode() && !signal.aborted && !this.disposed) {
      return { kind: 'result', value: 'allowed-once' };
    }
    const callback = this.approvalCallback;
    if (!callback || signal.aborted || this.disposed) return rejected;
    let resolveAborted!: (decision: 'cancel') => void;
    const cancelled = new Promise<'cancel'>(resolve => { resolveAborted = resolve; });
    const aborted = () => { resolveAborted('cancel'); this.approvalDismisser?.(); };
    signal.addEventListener('abort', aborted, { once: true });
    try {
      const decision = await Promise.race([cancelled, callback(typeof request.toolName === 'string' ? request.toolName : 'DeepSeek tool', request,
        typeof request.reason === 'string' ? request.reason : 'DeepSeek Harness requested tool approval.')]);
      if (signal.aborted || this.disposed) return rejected;
      return { kind: 'result', value: decision === 'allow' || decision === 'allow-always' ? 'allowed-once' : 'rejected' };
    } catch { return rejected; }
    finally { signal.removeEventListener('abort', aborted); }
  }

  private isYoloMode(): boolean {
    const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.plugin.settings, this.providerId);
    return snapshot.permissionMode === 'yolo';
  }

  cancel(): void {
    this.approvalDismisser?.();
    this.active?.close();
    if (this.lease && this.sessionId && this.ownsClaim) {
      void this.lease.client.call('session/cancel', { request: { sessionId: this.sessionId } }).catch(() => {});
    }
  }

  resetSession(): void {
    this.cancel();
    this.generation++;
    this.releaseLease();
    this.sessionId = null;
    this.binding = null;
    this.bindingError = null;
  }

  getSessionId(): string | null { return this.sessionId; }
  consumeSessionInvalidation(): boolean { return false; }
  isReady(): boolean { return this.ready && !this.disposed; }
  async getSupportedCommands(): Promise<SlashCommand[]> { return []; }
  async rewind(_userMessageId: string, _assistantMessageId: string | undefined, _mode?: ChatRewindMode): Promise<ChatRewindResult> {
    return { canRewind: false, error: 'DeepSeek native rewind is not supported.' };
  }
  setApprovalCallback(callback: ApprovalCallback | null): void { this.approvalCallback = callback; }
  setApprovalDismisser(dismisser: (() => void) | null): void { this.approvalDismisser = dismisser; }
  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}
  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}
  setPermissionModeSyncCallback(_callback: ((mode: string) => void) | null): void {}
  setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}
  consumeTurnMetadata(): ChatTurnMetadata { const metadata = this.metadata; this.metadata = {}; return metadata; }
  buildSessionUpdates(_params: { conversation: Conversation | null; sessionInvalidated: boolean }): SessionUpdateResult {
    if (this.bindingError || !this.binding) return { updates: {} };
    return { updates: { sessionId: this.sessionId, providerState: { ...this.binding } } };
  }
  resolveSessionIdForFork(_conversation: Conversation | null): string | null { return null; }

  cleanup(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.active?.close();
    this.approvalDismisser?.();
    const lease = this.lease;
    const sessionId = this.sessionId;
    this.lease = undefined;
    const cancel = lease && sessionId && this.ownsClaim
      ? lease.client.call('session/cancel', { request: { sessionId } }).catch(() => {}) : Promise.resolve();
    this.ownsClaim = false;
    this.setReady(false);
    void cancel.finally(() => lease?.release());
    this.readyListeners.clear();
  }

  private releaseLease(): void {
    this.lease?.release();
    this.lease = undefined;
    this.ownsClaim = false;
    this.setReady(false);
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) return;
    this.ready = ready;
    for (const listener of this.readyListeners) {
      try { listener(ready); } catch { /* Readiness observers have independent lifetimes. */ }
    }
  }
}
