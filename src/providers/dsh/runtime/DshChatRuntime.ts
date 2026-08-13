import * as path from 'node:path';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type {
  ProviderCapabilities,
} from '../../../core/providers/types';
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
  PreparedChatTurn,
  SessionUpdateResult,
} from '../../../core/runtime/types';
import { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type {
  ChatMessage,
  Conversation,
  ExitPlanModeCallback,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import { getVaultPath } from '../../../utils/path';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionNotification,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  buildAcpApprovalDecisionOptions,
  mapApprovalDecision,
} from '../../acp';
import { DshAgentStorage } from '../agents/DshAgentStorage';
import { DshMcpServerManager } from '../app/DshMcpServerManager';
import { DshModelDiscoveryService } from '../app/DshModelDiscoveryService';
import { ensureDshProfile } from '../app/DshProfileProvisioner';
import { DSH_PROVIDER_CAPABILITIES } from '../capabilities';
import {
  buildDshPermissionPresentation,
  normalizeApprovalInput,
} from '../internal/permissionPresentation';
import { decodeDshModelId, isDshModelSelectionId } from '../models';
import { getDshProviderSettings } from '../settings';
import { type DshProviderState,getDshState } from '../types';
import { buildDshPromptText } from './buildDshPrompt';
import { prepareDshLaunchArtifacts } from './DshLaunchArtifacts';
import { buildDshRuntimeEnv } from './DshRuntimeEnvironment';
import {
  type DshMentionAgent,
  expandAgentMentions,
} from './expandAgentMentions';

interface ActiveTurn {
  cancelled: boolean;
  queue: StreamChunkQueue;
  sessionId: string;
}

class StreamChunkQueue {
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
 * Adapts DeepSeek Harness through its automation-only ACP server
 * (`dsh --profile <name>`). One process per Claudian Plus runtime; each
 * conversation owns one ACP session. The ACP bridge emits only committed
 * assistant text, so the sidebar renders answer text without token-level
 * streaming or tool activity.
 */
export class DshChatRuntime implements ChatRuntime {
  readonly providerId = 'dsh' as const;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private connection: AcpClientConnection | null = null;
  private connectionGeneration = 0;
  private conversationId: string | null = null;
  private conversationGeneration = 0;
  private currentConversationModel: string | null = null;
  private currentLaunchKey: string | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private loadedSessionId: string | null = null;
  private permissionModeSyncCallback: ((mode: string) => void) | null = null;
  private process: AcpSubprocess | null = null;
  private readonly readyListeners: Array<(ready: boolean) => void> = [];
  private ready = false;
  private readinessFlight: { key: string; promise: Promise<boolean> } | null = null;
  private disposed = false;
  private lifecycleGeneration = 0;
  private sessionInvalidated = false;
  private sessionId: string | null = null;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;

  constructor(
    private readonly plugin: ProviderHost,
  ) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return DSH_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: buildDshPromptText(request),
      request,
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.push(listener);
    return () => {
      const index = this.readyListeners.indexOf(listener);
      if (index >= 0) {
        this.readyListeners.splice(index, 1);
      }
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(
    conversation: ChatRuntimeConversationState | null,
  ): void {
    this.setCurrentConversationModel(conversation?.selectedModel);
    const previousSessionId = this.sessionId;
    const nextConversationId = conversation?.id ?? null;
    const nextSessionId = conversation?.sessionId ?? null;
    const state = getDshState(conversation?.providerState);
    const nextStateSessionId = state.sessionId ?? null;
    const effectiveSessionId = nextSessionId ?? nextStateSessionId;
    const targetChanged = nextConversationId !== this.conversationId
      || effectiveSessionId !== previousSessionId;
    if (this.sessionId !== effectiveSessionId) {
      this.sessionInvalidated = false;
    }
    this.conversationId = nextConversationId;
    this.sessionId = effectiveSessionId;
    if (targetChanged) {
      this.conversationGeneration += 1;
      if (this.readinessFlight) {
        void this.shutdownProcess();
      }
    }
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    const conversationGeneration = this.conversationGeneration;
    const key = JSON.stringify({ conversationGeneration, options: options ?? {} });
    if (this.readinessFlight) {
      if (this.readinessFlight.key === key) {
        return this.readinessFlight.promise;
      }
      await this.readinessFlight.promise.catch(() => undefined);
      return this.ensureReady(options);
    }

    const lifecycleGeneration = this.lifecycleGeneration;
    const promise = this.ensureReadyInternal(
      options,
      lifecycleGeneration,
      conversationGeneration,
    );
    this.readinessFlight = { key, promise };
    return promise.finally(() => {
      if (this.readinessFlight?.promise === promise) {
        this.readinessFlight = null;
      }
    });
  }

  private async ensureReadyInternal(
    options: ChatRuntimeEnsureReadyOptions | undefined,
    lifecycleGeneration: number,
    conversationGeneration: number,
  ): Promise<boolean> {
    const settings = getDshProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const targetSessionId = this.sessionId;
    const resolvedCliPath = await this.plugin.getResolvedProviderCliPath('dsh');
    if (!resolvedCliPath) {
      throw new Error(
        'The `dsh` CLI was not found. Install DeepSeek Harness (npm install -g @deepseek-ai/dsh) and ensure the `dsh` command is available, or set a valid CLI path in Claudian Plus settings.',
      );
    }
    const runtimeEnv = this.buildRuntimeEnv(resolvedCliPath);
    const launchModel = this.resolveLaunchModel();
    const reasoningEffort = settings.reasoningEffort;
    const llmModels = settings.discoveredModels
      .filter((model) => model.contextWindow !== undefined)
      .map((model) => ({
        contextWindow: model.contextWindow,
        id: model.rawId,
        label: model.label ?? model.rawId,
      }));
    const skillDirs = [
      path.join(cwd, '.claude', 'skills'),
      path.join(cwd, '.codex', 'skills'),
    ];
    const mcpServers = await this.loadEnabledMcpServers();

    const baseLaunchKey = JSON.stringify({
      command: resolvedCliPath,
      envText: getRuntimeEnvironmentText(this.plugin.settings, 'dsh'),
      mcp: mcpServers.map((server) => server.name).sort(),
      model: launchModel,
      profile: settings.profile,
      providerRoute: settings.providerRoute,
      reasoningEffort,
      skillDirs,
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || options?.force === true
      || this.currentLaunchKey !== baseLaunchKey;

    if (shouldRestart) {
      await this.shutdownProcess();
      if (!this.isReadinessCurrent(lifecycleGeneration, conversationGeneration)) {
        return false;
      }
      const provision = await ensureDshProfile(
        settings.profile,
        settings.providerRoute,
      );
      if (provision.status === 'error') {
        throw new Error(provision.error);
      }
      // A freshly provisioned profile has a catalog the chat UI has not
      // discovered yet; refresh so context windows display immediately.
      await new DshModelDiscoveryService(this.plugin).refreshModelCatalog();
      const artifacts = await prepareDshLaunchArtifacts({
        llmModels,
        mcpServers,
        model: launchModel,
        profile: settings.profile,
        providerRoute: settings.providerRoute,
        reasoningEffort,
        skillDirs,
        workspaceRoot: cwd,
      });
      if (!this.isReadinessCurrent(lifecycleGeneration, conversationGeneration)) {
        return false;
      }
      await this.startProcess({
        command: resolvedCliPath,
        cwd,
        patchPath: artifacts.patchPath,
        profile: settings.profile,
        runtimeEnv,
      });
      if (!this.isReadinessCurrent(lifecycleGeneration, conversationGeneration)) {
        await this.shutdownProcess();
        return false;
      }
      this.currentLaunchKey = baseLaunchKey;
      this.loadedSessionId = null;
      this.setReady(true);
    }

    // DSH ACP is fresh-sessions only: a stored session id belongs to a dead
    // process (or an unreachable agent), so treat it as invalidated and let
    // the next turn bootstrap the conversation history into a new session.
    if (targetSessionId) {
      if (this.loadedSessionId !== targetSessionId) {
        this.sessionInvalidated = true;
        this.clearActiveSession();
      }
      return true;
    }

    if (!this.sessionId && !this.sessionInvalidated) {
      if (options?.allowSessionCreation === false) {
        return true;
      }
      const sessionId = await this.createSession(cwd, conversationGeneration);
      if (!this.isReadinessCurrent(lifecycleGeneration, conversationGeneration)) {
        await this.shutdownProcess();
        return false;
      }
      return Boolean(sessionId);
    }

    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (this.activeTurn) {
      yield { type: 'error', content: 'DeepSeek does not support overlapping turns.' };
      yield { type: 'done' };
      return;
    }
    if (queryOptions?.model) {
      this.setCurrentConversationModel(queryOptions.model);
    }
    const conversationGeneration = this.conversationGeneration;
    const previousMessages = conversationHistory ?? [];
    const expectedSessionId = this.sessionId;
    let shouldBootstrapHistory = previousMessages.length > 0
      && (!expectedSessionId || this.sessionInvalidated);

    let ready: boolean;
    try {
      ready = await this.ensureReady();
    } catch (error) {
      yield { type: 'error', content: this.formatRuntimeError(error) };
      yield { type: 'done' };
      return;
    }

    if (!ready) {
      const message = getDshProviderSettings(this.plugin.settings).enabled
        ? 'Failed to start the DeepSeek Harness runtime. Check the `dsh` CLI path and the profile configuration.'
        : 'DeepSeek is disabled. Enable DeepSeek in Claudian Plus settings before starting a chat.';
      yield { type: 'error', content: message };
      yield { type: 'done' };
      return;
    }

    if (!this.isConversationCurrent(conversationGeneration)) {
      yield { type: 'error', content: 'DeepSeek conversation changed before the turn started.' };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: 'DeepSeek runtime is not ready.' };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    if (expectedSessionId && !this.sessionId) {
      shouldBootstrapHistory = previousMessages.length > 0;
    }

    if (!this.sessionId) {
      const sessionId = await this.createSession(cwd, conversationGeneration);
      if (!sessionId) {
        yield { type: 'error', content: 'Failed to create a DeepSeek session.' };
        yield { type: 'done' };
        return;
      }
    }

    const sessionId = this.sessionId!;
    this.activeTurn = {
      cancelled: false,
      queue: new StreamChunkQueue(),
      sessionId,
    };
    this.currentTurnMetadata = {};
    this.sessionUpdateNormalizer.reset();

    const activeTurn = this.activeTurn;
    const [memoryAppendix, consciousnessAppendix] = await Promise.all([
      this.plugin.getMemoryInjectionText(),
      this.plugin.getConsciousnessInjectionText(),
    ]);
    const promptText = buildDshPromptText(
      turn.request,
      shouldBootstrapHistory ? previousMessages : [],
      [memoryAppendix, consciousnessAppendix].filter(Boolean) as string[],
    );
    const mentionAgents = await this.loadMentionAgents();
    const expandedPrompt = expandAgentMentions(promptText, mentionAgents);

    const promptPromise = this.connection.prompt({
      prompt: [{ type: 'text', text: expandedPrompt }],
      sessionId,
    }).then(() => {
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).catch((error) => {
      activeTurn.queue.push({
        type: 'error',
        content: this.formatRuntimeError(error),
      });
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).finally(() => {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    });

    try {
      while (true) {
        const chunk = await activeTurn.queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
      }
      if (!activeTurn.cancelled) {
        await promptPromise;
      }
    } finally {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  cancel(): void {
    const activeTurn = this.activeTurn;
    if (!activeTurn || activeTurn.cancelled) {
      return;
    }
    if (this.connection && this.sessionId) {
      this.connection.cancel({ sessionId: this.sessionId });
    }
    this.settleActiveTurn();
  }

  resetSession(): void {
    this.clearActiveSession();
    this.sessionInvalidated = false;
  }

  getSessionId(): string | null {
    return this.sessionId;
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
    return [];
  }

  cleanup(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.activeTurn?.queue.close();
    void this.shutdownProcess();
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string | undefined,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  setApprovalDismisser(_dismisser: (() => void) | null): void {}

  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}

  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}

  setPermissionModeSyncCallback(callback: ((mode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
  }

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
    const existingState = params.conversation
      ? getDshState(params.conversation.providerState)
      : null;
    const providerState: DshProviderState = {
      ...(this.sessionId || existingState?.sessionId
        ? { sessionId: this.sessionId ?? existingState?.sessionId }
        : {}),
    };
    const updates: Partial<Conversation> = {
      providerState: Object.keys(providerState).length > 0
        ? providerState as Record<string, unknown>
        : undefined,
      sessionId: this.sessionId,
    };

    if (params.sessionInvalidated) {
      if (!this.sessionId) {
        updates.providerState = undefined;
        updates.sessionId = null;
      }
    }

    return { updates };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.sessionId ?? conversation?.sessionId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  private async startProcess(params: {
    command: string;
    cwd: string;
    patchPath: string;
    profile: string;
    runtimeEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    this.process = new AcpSubprocess({
      args: ['--profile', params.profile, '--patch', params.patchPath],
      command: params.command,
      cwd: params.cwd,
      env: params.runtimeEnv,
    });
    this.process.start();

    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: (listener) => this.process!.onClose(listener),
      output: this.process.stdin,
    });
    const transport = this.transport;
    this.unregisterTransportClose = transport.onClose((error) => {
      if (this.transport === transport) {
        this.setReady(false);
        this.settleActiveTurn(error ?? new Error('DeepSeek runtime closed'));
      }
    });

    const connectionGeneration = ++this.connectionGeneration;
    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        onSessionNotification: (notification) => this.handleSessionNotification(
          notification,
          connectionGeneration,
        ),
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
  }

  private async shutdownProcess(): Promise<void> {
    this.connectionGeneration += 1;
    this.setReady(false);
    this.settleActiveTurn();

    this.unregisterTransportClose?.();
    this.unregisterTransportClose = null;

    this.connection?.dispose();
    this.connection = null;

    this.transport?.dispose();
    this.transport = null;

    if (this.process) {
      await this.process.shutdown().catch(() => {});
      this.process = null;
    }
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }

    this.ready = ready;
    for (const listener of this.readyListeners) {
      listener(ready);
    }
  }

  private isLifecycleCurrent(generation: number): boolean {
    return !this.disposed && generation === this.lifecycleGeneration;
  }

  private isConversationCurrent(generation: number): boolean {
    return generation === this.conversationGeneration;
  }

  private isReadinessCurrent(
    lifecycleGeneration: number,
    conversationGeneration: number,
  ): boolean {
    return this.isLifecycleCurrent(lifecycleGeneration)
      && this.isConversationCurrent(conversationGeneration);
  }

  private buildRuntimeEnv(cliPath: string): NodeJS.ProcessEnv {
    return buildDshRuntimeEnv(
      this.plugin.settings,
      cliPath,
    );
  }

  private getProviderSettings(): Record<string, unknown> {
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      this.providerId,
    );
    if (this.currentConversationModel) {
      settings.model = this.currentConversationModel;
    }
    return settings;
  }

  /**
   * The model pinned into the DSH launch overlay. DSH ACP fixes the model per
   * process, so changing the model restarts the runtime (and invalidates the
   * current session).
   */
  private resolveLaunchModel(): string {
    const providerSettings = this.getProviderSettings();
    const selectedModel = typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';
    if (selectedModel) {
      const rawModelId = isDshModelSelectionId(selectedModel)
        ? decodeDshModelId(selectedModel)
        : null;
      if (rawModelId) {
        return rawModelId;
      }
    }

    const dshSettings = getDshProviderSettings(this.plugin.settings);
    return dshSettings.visibleModels[0] ?? 'deepseek-v4-flash';
  }

  getAuxiliaryModel(): string | null {
    return this.currentConversationModel ?? null;
  }

  private setCurrentConversationModel(model: unknown): void {
    const selectedModel = typeof model === 'string' ? model.trim() : '';
    this.currentConversationModel = selectedModel || null;
  }

  private async createSession(
    cwd: string,
    conversationGeneration = this.conversationGeneration,
  ): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    try {
      const response = await this.connection.newSession({
        cwd,
        mcpServers: [],
      });
      if (!this.isConversationCurrent(conversationGeneration)) {
        return null;
      }
      this.loadedSessionId = response.sessionId;
      this.sessionId = response.sessionId;
      return response.sessionId;
    } catch {
      return null;
    }
  }

  private async handleSessionNotification(
    notification: AcpSessionNotification,
    connectionGeneration = this.connectionGeneration,
  ): Promise<void> {
    if (connectionGeneration !== this.connectionGeneration) {
      return;
    }
    if (notification.sessionId !== this.sessionId) {
      return;
    }

    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
    if (normalized.type !== 'message_chunk') {
      return;
    }

    if (!this.activeTurn || this.activeTurn.sessionId !== notification.sessionId) {
      return;
    }

    if (normalized.role === 'assistant' && normalized.messageId) {
      this.currentTurnMetadata.assistantMessageId = normalized.messageId;
    }
    if (normalized.role === 'user' && normalized.messageId) {
      this.currentTurnMetadata.userMessageId = normalized.messageId;
    }
    for (const chunk of normalized.streamChunks) {
      this.activeTurn.queue.push(chunk);
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    if (!this.approvalCallback) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const input = normalizeApprovalInput(request.toolCall.rawInput);
    const presentation = buildDshPermissionPresentation(request.toolCall.title, input, request.toolCall.locations);
    const decision = await this.approvalCallback(
      presentation.toolName,
      input,
      presentation.description,
      {
        ...(presentation.blockedPath ? { blockedPath: presentation.blockedPath } : {}),
        ...(presentation.decisionReason ? { decisionReason: presentation.decisionReason } : {}),
        decisionOptions: buildAcpApprovalDecisionOptions(request.options),
      },
    );

    return mapApprovalDecision(decision, request.options);
  }

  private settleActiveTurn(error?: Error): void {
    const activeTurn = this.activeTurn;
    if (!activeTurn || activeTurn.cancelled) {
      return;
    }

    activeTurn.cancelled = true;
    if (error) {
      activeTurn.queue.push({ type: 'error', content: this.formatRuntimeError(error) });
    }
    activeTurn.queue.push({ type: 'done' });
    activeTurn.queue.close();
    if (this.activeTurn === activeTurn) {
      this.activeTurn = null;
    }
  }

  private formatRuntimeError(error: unknown): string {
    const baseMessage = error instanceof Error ? error.message : 'DeepSeek request failed';
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${baseMessage}\n\n${stderr}` : baseMessage;
  }

  private clearActiveSession(): void {
    this.sessionId = null;
    this.loadedSessionId = null;
  }

  private mcpManager: DshMcpServerManager | null = null;
  private agentStorage: DshAgentStorage | null = null;

  private getVaultAdapter(): VaultFileAdapter {
    return new VaultFileAdapter(this.plugin.app);
  }

  private async loadEnabledMcpServers() {
    const manager = this.mcpManager ?? new DshMcpServerManager(this.getVaultAdapter());
    this.mcpManager = manager;
    await manager.ensureLoaded();
    return manager.getServers().filter((server) => server.enabled);
  }

  /** Loads vault and home agents for `@agent (agent)` mention expansion. */
  private async loadMentionAgents(): Promise<Map<string, DshMentionAgent>> {
    const storage = this.agentStorage
      ?? new DshAgentStorage(this.getVaultAdapter(), new HomeFileAdapter());
    this.agentStorage = storage;
    const agents = await storage.loadAll();

    const result = new Map<string, DshMentionAgent>();
    const vaultAdapter = this.getVaultAdapter();
    const homeAdapter = new HomeFileAdapter();
    for (const agent of agents) {
      try {
        const adapter = agent.origin === 'home' ? homeAdapter : vaultAdapter;
        const fileContent = await adapter.read(agent.filePath);
        result.set(agent.id, {
          description: agent.description,
          fileContent,
          id: agent.id,
          name: agent.name,
        });
      } catch {
        // Skip unreadable agent files.
      }
    }
    return result;
  }
}
