import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
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
import type {
  ChatMessage,
  Conversation,
  ExitPlanModeCallback,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import { findNodeExecutable, getEnhancedPath } from '../../../utils/env';
import { getVaultPath, isPathWithinDirectory } from '../../../utils/path';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpMcpServer,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionModelState,
  type AcpSessionNotification,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  type AcpUsage,
  type AcpUsageUpdate,
  type AcpWriteTextFileRequest,
  buildAcpApprovalDecisionOptions,
  buildAcpUsageInfo,
  extractAcpSessionModelState,
  mapApprovalDecision,
} from '../../acp';
import { KIMI_PROVIDER_CAPABILITIES } from '../capabilities';
import { updateKimiDiscoveryState } from '../discoveryState';
import {
  buildKimiPermissionPresentation,
  normalizeApprovalInput,
} from '../internal/permissionPresentation';
import {
  decodeKimiModelId,
  encodeKimiModelId,
  isKimiModelSelectionId,
  KIMI_SYNTHETIC_MODEL_ID,
  normalizeKimiDiscoveredModels,
  resolveKimiBaseModelRawId,
} from '../models';
import { createKimiToolStreamAdapter } from '../normalization/kimiToolNormalization';
import { getKimiProviderSettings, updateKimiProviderSettings } from '../settings';
import { getKimiState, type KimiProviderState } from '../types';
import { buildKimiPromptBlocks, buildKimiPromptText } from './buildKimiPrompt';
import {
  type KimiLaunchArtifacts,
  prepareKimiLaunchArtifacts,
} from './KimiLaunchArtifacts';
import { buildKimiRuntimeEnv } from './KimiRuntimeEnvironment';

const KIMI_AUTH_REQUIRED_ERROR_CODE = -32000;

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

export class KimiChatRuntime implements ChatRuntime {
  readonly providerId = 'kimi' as const;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private connection: AcpClientConnection | null = null;
  private connectionGeneration = 0;
  private conversationId: string | null = null;
  private conversationGeneration = 0;
  private contextUsage: AcpUsageUpdate | null = null;
  private currentLaunchKey: string | null = null;
  private currentArtifacts: KimiLaunchArtifacts | null = null;
  private currentSessionModelId: string | null = null;
  private currentConversationModel: string | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private loadedSessionId: string | null = null;
  private permissionModeSyncCallback: ((mode: string) => void) | null = null;
  private process: AcpSubprocess | null = null;
  private promptUsage: AcpUsage | null = null;
  private readonly readyListeners: Array<(ready: boolean) => void> = [];
  private ready = false;
  private readinessFlight: { key: string; promise: Promise<boolean> } | null = null;
  private disposed = false;
  private lifecycleGeneration = 0;
  private restartRequiredAfterCancel = false;
  private sessionInvalidated = false;
  private readonly supportedCommandWaiters: Array<(commands: SlashCommand[]) => void> = [];
  private supportedCommands: SlashCommand[] = [];
  private sessionCwds = new Map<string, string>();
  private sessionId: string | null = null;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private readonly toolStreamAdapter = createKimiToolStreamAdapter();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;

  constructor(
    private readonly plugin: ProviderHost,
  ) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return KIMI_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: buildKimiPromptText(request),
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
    const state = getKimiState(conversation?.providerState);
    const nextStateSessionId = state.sessionId ?? null;
    const effectiveSessionId = nextSessionId ?? nextStateSessionId;
    const targetChanged = nextConversationId !== this.conversationId
      || effectiveSessionId !== previousSessionId;
    if (this.sessionId !== effectiveSessionId) {
      this.currentSessionModelId = null;
      this.sessionInvalidated = false;
      this.setSupportedCommands([]);
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

  async warmModelMetadata(model: string): Promise<boolean> {
    const conversationGeneration = this.conversationGeneration;
    const selectedRawModelId = decodeKimiModelId(model);
    if (!selectedRawModelId) {
      return false;
    }

    if (!(await this.ensureReady({ allowSessionCreation: true }))) {
      return false;
    }
    if (
      !this.connection
      || !this.sessionId
      || !this.isConversationCurrent(conversationGeneration)
    ) {
      return false;
    }

    const discoveredModels = getKimiProviderSettings(this.plugin.settings).discoveredModels;
    const selectedBaseRawModelId = resolveKimiBaseModelRawId(selectedRawModelId, discoveredModels);
    if (!selectedBaseRawModelId) {
      return false;
    }

    const availableModelIds = new Set(discoveredModels.map((entry) => entry.rawId));
    if (availableModelIds.size > 0 && !availableModelIds.has(selectedBaseRawModelId)) {
      return false;
    }

    try {
      await this.connection.setModel({
        modelId: selectedBaseRawModelId,
        sessionId: this.sessionId,
      });
    } catch {
      return false;
    }
    if (!this.isConversationCurrent(conversationGeneration)) {
      return false;
    }
    this.currentSessionModelId = selectedBaseRawModelId;
    return this.isConversationCurrent(conversationGeneration);
  }

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
    const settings = getKimiProviderSettings(this.plugin.settings);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const targetSessionId = this.sessionId;
    const resolvedCliPath = await this.plugin.getResolvedProviderCliPath('kimi');
    if (!resolvedCliPath) {
      throw new Error(
        'Kimi Code CLI was not found. Install Kimi Code CLI and ensure the `kimi` command is available, or set a valid CLI path in Claudian Plus settings.',
      );
    }
    const runtimeEnv = this.buildRuntimeEnv(resolvedCliPath);
    const nodeExecutable = findNodeExecutable(getEnhancedPath(runtimeEnv.PATH, resolvedCliPath)) ?? undefined;
    const obsidianBridge = nodeExecutable && this.plugin.ensureObsidianToolBridge
      ? await this.plugin.ensureObsidianToolBridge().catch(() => undefined)
      : undefined;
    if (obsidianBridge) {
      runtimeEnv.CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_URL = obsidianBridge.url;
      runtimeEnv.CLAUDIAN_PLUS_OBSIDIAN_BRIDGE_TOKEN = obsidianBridge.token;
    }
    const promptSettings = this.getSystemPromptSettings(cwd);
    const [memoryAppendix, consciousnessAppendix] = await Promise.all([
      this.plugin.getMemoryInjectionText(),
      this.plugin.getConsciousnessInjectionText(),
    ]);
    const combinedAppendix = [memoryAppendix, consciousnessAppendix].filter(Boolean).join('\n\n') || undefined;

    const baseLaunchKey = JSON.stringify({
      command: resolvedCliPath,
      envText: getRuntimeEnvironmentText(this.plugin.settings, 'kimi'),
      promptKey: computeSystemPromptKey(promptSettings),
      appendixKey: combinedAppendix ?? '',
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || options?.force === true
      || this.restartRequiredAfterCancel
      || this.currentLaunchKey !== baseLaunchKey;

    if (shouldRestart) {
      await this.shutdownProcess();
      if (!this.isReadinessCurrent(lifecycleGeneration, conversationGeneration)) {
        return false;
      }
      // Prepare the Obsidian MCP sidecar after the old runtime (and its
      // sidecar) is disposed, so the new session can be created with it.
      const artifacts = await prepareKimiLaunchArtifacts({
        nodeExecutable,
        obsidianBridge,
        workspaceRoot: cwd,
      });
      if (!this.isReadinessCurrent(lifecycleGeneration, conversationGeneration)) {
        artifacts.dispose();
        return false;
      }
      this.currentArtifacts = artifacts;
      await this.startProcess({
        command: resolvedCliPath,
        cwd,
        runtimeEnv,
      });
      if (!this.isReadinessCurrent(lifecycleGeneration, conversationGeneration)) {
        await this.shutdownProcess();
        return false;
      }
      this.restartRequiredAfterCancel = false;
      this.currentLaunchKey = JSON.stringify({
        base: baseLaunchKey,
        mcp: artifacts.launchKey,
      });
      this.loadedSessionId = null;
      this.setReady(true);
    }

    if (targetSessionId) {
      if (this.loadedSessionId !== targetSessionId) {
        const loaded = await this.loadSession(targetSessionId, cwd, conversationGeneration);
        if (!this.isReadinessCurrent(lifecycleGeneration, conversationGeneration)) {
          await this.shutdownProcess();
          return false;
        }
        if (!loaded) {
          this.sessionInvalidated = true;
          this.clearActiveSession();
        }
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
      yield { type: 'error', content: 'Kimi does not support overlapping turns.' };
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
      const message = getKimiProviderSettings(this.plugin.settings).enabled
        ? 'Failed to start Kimi Code CLI. Check the CLI path and login state.'
        : 'Kimi is disabled. Enable Kimi in Claudian Plus settings before starting a chat.';
      yield { type: 'error', content: message };
      yield { type: 'done' };
      return;
    }

    if (!this.isConversationCurrent(conversationGeneration)) {
      yield { type: 'error', content: 'Kimi conversation changed before the turn started.' };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: 'Kimi runtime is not ready.' };
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
        yield { type: 'error', content: 'Failed to create a Kimi session.' };
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
    this.contextUsage = null;
    this.promptUsage = null;
    this.sessionUpdateNormalizer.reset();
    this.toolStreamAdapter.reset();

    const activeTurn = this.activeTurn;
    try {
      await this.applySelectedModel(sessionId, queryOptions, conversationGeneration);
      if (!this.isConversationCurrent(conversationGeneration)) {
        throw new Error('Kimi conversation changed before the turn started.');
      }
    } catch (error) {
      yield {
        type: 'error',
        content: this.formatRuntimeError(error),
      };
      yield { type: 'done' };
      activeTurn.queue.close();
      this.activeTurn = null;
      return;
    }

    const [memoryAppendix, consciousnessAppendix] = await Promise.all([
      this.plugin.getMemoryInjectionText(),
      this.plugin.getConsciousnessInjectionText(),
    ]);

    const promptPromise = this.connection.prompt({
      prompt: buildKimiPromptBlocks(
        turn.request,
        shouldBootstrapHistory ? previousMessages : [],
        [memoryAppendix, consciousnessAppendix].filter(Boolean) as string[],
      ),
      sessionId,
    }).then((response) => {
      if (response.userMessageId) {
        this.currentTurnMetadata.userMessageId = response.userMessageId;
      }
      this.promptUsage = response.usage ?? null;

      const usage = buildAcpUsageInfo({
        contextWindow: this.contextUsage,
        model: this.getActiveDisplayModel(queryOptions),
        promptUsage: this.promptUsage,
      });
      if (usage) {
        activeTurn.queue.push({ sessionId, type: 'usage', usage });
      }

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
    this.restartRequiredAfterCancel = true;
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
    if (this.supportedCommands.length > 0 && this.loadedSessionId === this.sessionId) {
      return [...this.supportedCommands];
    }

    if (this.sessionId && this.loadedSessionId !== this.sessionId) {
      const ready = await this.ensureReady({ allowSessionCreation: false });
      if (!ready) {
        return [];
      }
    }

    if (!this.sessionId) {
      return [];
    }

    if (this.supportedCommands.length > 0) {
      return [...this.supportedCommands];
    }

    if (!this.sessionId || this.loadedSessionId !== this.sessionId) {
      return [];
    }

    return this.waitForSupportedCommands();
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

  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {
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
      ? getKimiState(params.conversation.providerState)
      : null;
    const providerState: KimiProviderState = {
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
    runtimeEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    this.process = new AcpSubprocess({
      args: ['acp'],
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
        this.settleActiveTurn(error ?? new Error('Kimi runtime closed'));
      }
    });

    const connectionGeneration = ++this.connectionGeneration;
    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        fileSystem: {
          readTextFile: (request) => this.readTextFile(request),
          writeTextFile: (request) => this.writeTextFile(request),
        },
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
    this.currentSessionModelId = null;
    this.setSupportedCommands([]);
    this.disposeArtifacts();

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

  private disposeArtifacts(): void {
    const artifacts = this.currentArtifacts;
    this.currentArtifacts = null;
    artifacts?.dispose();
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

  private getSystemPromptSettings(vaultPath: string): SystemPromptSettings {
    return {
      customPrompt: this.plugin.settings.systemPrompt,
      mediaFolder: this.plugin.settings.mediaFolder,
      userName: this.plugin.settings.userName,
      vaultPath,
    };
  }

  private buildRuntimeEnv(cliPath: string): NodeJS.ProcessEnv {
    return buildKimiRuntimeEnv(
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

  private resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    const providerSettings = this.getProviderSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (!isKimiModelSelectionId(selectedModel)) {
      return null;
    }

    // Keep the full id (including a possible `,thinking` variant) — Kimi
    // expresses thinking by the model id itself, so base-izing here would drop
    // the user's thinking selection.
    const selectedRawModelId = decodeKimiModelId(selectedModel);
    if (!selectedRawModelId) {
      return null;
    }

    const discoveredModels = getKimiProviderSettings(providerSettings).discoveredModels;
    const availableModelIds = new Set(discoveredModels.map((model) => model.rawId));
    if (availableModelIds.size > 0 && !availableModelIds.has(selectedRawModelId)) {
      // Accept the base id when the exact id was not discovered yet.
      const baseRawId = resolveKimiBaseModelRawId(selectedRawModelId, discoveredModels);
      return availableModelIds.has(baseRawId) ? baseRawId : null;
    }

    return selectedRawModelId;
  }

  getAuxiliaryModel(): string | null {
    return this.currentConversationModel ?? this.getActiveDisplayModel() ?? null;
  }

  private setCurrentConversationModel(model: unknown): void {
    const selectedModel = typeof model === 'string' ? model.trim() : '';
    this.currentConversationModel = selectedModel || null;
  }

  private getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string | undefined {
    const providerSettings = this.getProviderSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (
      selectedModel
      && selectedModel !== KIMI_SYNTHETIC_MODEL_ID
      && isKimiModelSelectionId(selectedModel)
    ) {
      const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
      return selectedRawModelId
        ? encodeKimiModelId(selectedRawModelId)
        : selectedModel;
    }

    return this.currentSessionModelId
      ? encodeKimiModelId(this.currentSessionModelId)
      : (selectedModel && isKimiModelSelectionId(selectedModel) ? selectedModel : undefined);
  }

  private async applySelectedModel(
    sessionId: string,
    queryOptions?: ChatRuntimeQueryOptions,
    conversationGeneration = this.conversationGeneration,
  ): Promise<void> {
    if (!this.connection) {
      return;
    }

    const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
    if (!selectedRawModelId || selectedRawModelId === this.currentSessionModelId) {
      return;
    }

    try {
      await this.connection.setModel({
        modelId: selectedRawModelId,
        sessionId,
      });
    } catch (error) {
      if (isKimiAuthRequiredError(error)) {
        throw new Error(KIMI_AUTH_REQUIRED_MESSAGE, error instanceof Error ? { cause: error } : undefined);
      }
      throw error;
    }
    if (!this.isConversationCurrent(conversationGeneration)) {
      return;
    }
    this.currentSessionModelId = selectedRawModelId;
  }

  private async syncSessionModelState(params: {
    models?: AcpSessionModelState | null;
  }, conversationGeneration?: number): Promise<void> {
    if (
      conversationGeneration !== undefined
      && !this.isConversationCurrent(conversationGeneration)
    ) {
      return;
    }
    const acpState = extractAcpSessionModelState(params);
    const currentRawModelId = acpState.currentModelId ?? this.currentSessionModelId;
    const discoveredModels = normalizeKimiDiscoveredModels(
      acpState.availableModels.map((model) => ({
        ...(model.description ? { description: model.description } : {}),
        label: model.name,
        rawId: model.id,
      })),
    );
    if (currentRawModelId) {
      this.currentSessionModelId = currentRawModelId;
    }

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const currentSettings = getKimiProviderSettings(settingsBag);
    const currentBaseRawModelId = currentRawModelId
      ? resolveKimiBaseModelRawId(currentRawModelId, discoveredModels)
      : null;
    const nextVisibleModels = currentSettings.visibleModels.length === 0 && currentBaseRawModelId
      ? [currentBaseRawModelId]
      : currentSettings.visibleModels;
    const shouldSeedVisibleModels = !sameStringList(currentSettings.visibleModels, nextVisibleModels);
    const shouldUpdateDiscoveredModels = discoveredModels.length > 0
      && !sameDiscoveredModels(currentSettings.discoveredModels, discoveredModels);
    const discoveryChanged = shouldUpdateDiscoveredModels
      && updateKimiDiscoveryState(settingsBag, { discoveredModels });
    let changed = shouldSeedVisibleModels;

    // Seed the full session model id (variant included) so a `,thinking`
    // selection survives settings persistence.
    if (currentRawModelId) {
      const probeSettings = {
        ...settingsBag,
        savedProviderModel: {
          ...(settingsBag.savedProviderModel as Record<string, unknown> | undefined),
        },
      };
      const seeded = this.seedActiveModelSelection(
        probeSettings,
        encodeKimiModelId(currentRawModelId),
      );
      changed = changed || seeded;
    }

    if (!changed && !discoveryChanged) {
      return;
    }

    if (changed) {
      await this.plugin.mutateSettings((settings) => {
        if (
          conversationGeneration !== undefined
          && !this.isConversationCurrent(conversationGeneration)
        ) {
          return;
        }
        if (currentRawModelId) {
          this.seedActiveModelSelection(
            settings,
            encodeKimiModelId(currentRawModelId),
          );
        }
        if (shouldSeedVisibleModels) {
          updateKimiProviderSettings(settings, {
            visibleModels: nextVisibleModels,
          });
        }
      });
    }
    if (
      conversationGeneration !== undefined
      && !this.isConversationCurrent(conversationGeneration)
    ) {
      return;
    }
    this.refreshModelSelectors();
  }

  private seedActiveModelSelection(
    settingsBag: Record<string, unknown>,
    modelSelection: string,
  ): boolean {
    let changed = false;
    const savedProviderModel = settingsBag.savedProviderModel;
    if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
      const savedEntry = (savedProviderModel as Record<string, unknown>).kimi;
      const savedModel = typeof savedEntry === 'string' ? savedEntry : '';
      if (!savedModel || savedModel === KIMI_SYNTHETIC_MODEL_ID) {
        (savedProviderModel as Record<string, unknown>).kimi = modelSelection;
        changed = true;
      }
    } else {
      settingsBag.savedProviderModel = { kimi: modelSelection };
      changed = true;
    }

    const activeModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
    if (!activeModel || activeModel === KIMI_SYNTHETIC_MODEL_ID) {
      settingsBag.model = modelSelection;
      changed = true;
    }

    return changed;
  }

  private refreshModelSelectors(): void {
    this.plugin.refreshModelSelectors?.();
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

  private async createSession(
    cwd: string,
    conversationGeneration = this.conversationGeneration,
  ): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    const mcpServers = this.currentArtifacts?.mcpServers ?? [];
    const attempts: AcpMcpServer[][] = mcpServers.length > 0 ? [mcpServers, []] : [[]];
    for (const candidateServers of attempts) {
      try {
        this.setSupportedCommands([]);
        const response = await this.connection.newSession({
          cwd,
          mcpServers: candidateServers,
        });
        if (!this.isConversationCurrent(conversationGeneration)) {
          return null;
        }
        this.loadedSessionId = response.sessionId;
        this.sessionId = response.sessionId;
        this.sessionCwds.set(response.sessionId, cwd);
        await this.syncSessionModelState({
          models: response.models ?? null,
        }, conversationGeneration);
        if (!this.isConversationCurrent(conversationGeneration)) {
          return null;
        }
        return response.sessionId;
      } catch (error) {
        if (isKimiAuthRequiredError(error)) {
          throw new Error(KIMI_AUTH_REQUIRED_MESSAGE, error instanceof Error ? { cause: error } : undefined);
        }
        // The agent may reject stdio MCP servers at the protocol level; fall
        // back to a session without injected servers.
        if (candidateServers.length > 0) {
          continue;
        }
        return null;
      }
    }
    return null;
  }

  private async loadSession(
    sessionId: string,
    cwd: string,
    conversationGeneration = this.conversationGeneration,
  ): Promise<boolean> {
    if (!this.connection) {
      return false;
    }

    const mcpServers = this.currentArtifacts?.mcpServers ?? [];
    const attempts: AcpMcpServer[][] = mcpServers.length > 0 ? [mcpServers, []] : [[]];
    for (const candidateServers of attempts) {
      try {
        this.setSupportedCommands([]);
        const response = await this.connection.loadSession({
          cwd,
          mcpServers: candidateServers,
          sessionId,
        });
        if (!this.isConversationCurrent(conversationGeneration)) {
          return false;
        }
        this.sessionInvalidated = false;
        this.loadedSessionId = response.sessionId;
        this.sessionId = response.sessionId;
        this.sessionCwds.set(response.sessionId, cwd);
        await this.syncSessionModelState({
          models: response.models ?? null,
        }, conversationGeneration);
        if (!this.isConversationCurrent(conversationGeneration)) {
          return false;
        }
        return true;
      } catch (error) {
        if (isKimiAuthRequiredError(error)) {
          throw new Error(KIMI_AUTH_REQUIRED_MESSAGE, error instanceof Error ? { cause: error } : undefined);
        }
        if (candidateServers.length > 0) {
          continue;
        }
        return false;
      }
    }
    return false;
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
    if (normalized.type === 'config_options') {
      return;
    }

    if (normalized.type === 'commands') {
      this.setSupportedCommands(normalized.commands);
      return;
    }

    if (!this.activeTurn || this.activeTurn.sessionId !== notification.sessionId) {
      return;
    }

    switch (normalized.type) {
      case 'message_chunk': {
        if (normalized.role === 'assistant' && normalized.messageId) {
          this.currentTurnMetadata.assistantMessageId = normalized.messageId;
        }
        if (normalized.role === 'user' && normalized.messageId) {
          this.currentTurnMetadata.userMessageId = normalized.messageId;
        }
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const streamChunks = normalized.type === 'tool_call'
          ? this.toolStreamAdapter.normalizeToolCall(normalized.toolCall, normalized.streamChunks)
          : this.toolStreamAdapter.normalizeToolCallUpdate(normalized.toolCallUpdate, normalized.streamChunks);

        for (const chunk of streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      }
      case 'usage': {
        this.contextUsage = normalized.usage;
        const usage = buildAcpUsageInfo({
          contextWindow: normalized.usage,
          model: this.getActiveDisplayModel(),
          promptUsage: this.promptUsage,
        });
        if (usage) {
          this.activeTurn.queue.push({
            sessionId: notification.sessionId,
            type: 'usage',
            usage,
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    if (this.getProviderSettings().permissionMode === 'yolo') {
      // Prefer one-shot grants so YOLO does not persist approval state in Kimi.
      return mapApprovalDecision('allow', request.options);
    }

    if (!this.approvalCallback) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const input = normalizeApprovalInput(request.toolCall.rawInput);
    const presentation = buildKimiPermissionPresentation(request.toolCall.title, input, request.toolCall.locations);
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

  private setSupportedCommands(commands: SlashCommand[]): void {
    this.supportedCommands = commands.map((command) => ({ ...command }));

    const waiters = this.supportedCommandWaiters.splice(0);
    for (const waiter of waiters) {
      waiter(this.supportedCommands);
    }
  }

  private waitForSupportedCommands(timeoutMs = 250): Promise<SlashCommand[]> {
    if (this.supportedCommands.length > 0) {
      return Promise.resolve([...this.supportedCommands]);
    }

    return new Promise<SlashCommand[]>((resolve) => {
      const waiter = (commands: SlashCommand[]) => {
        window.clearTimeout(timeoutId);
        resolve([...commands]);
      };
      const timeoutId = window.setTimeout(() => {
        const index = this.supportedCommandWaiters.indexOf(waiter);
        if (index >= 0) {
          this.supportedCommandWaiters.splice(index, 1);
        }
        resolve([...this.supportedCommands]);
      }, timeoutMs);

      this.supportedCommandWaiters.push(waiter);
    });
  }

  private async readTextFile(
    request: AcpReadTextFileRequest,
  ): Promise<{ content: string }> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    const content = await fs.readFile(resolvedPath, 'utf-8');

    if (request.line === undefined && request.limit === undefined) {
      return { content };
    }

    const lines = content.split(/\r?\n/);
    const startIndex = Math.max(0, (request.line ?? 1) - 1);
    const endIndex = request.limit
      ? startIndex + Math.max(0, request.limit)
      : lines.length;

    return {
      content: lines.slice(startIndex, endIndex).join('\n'),
    };
  }

  private async writeTextFile(
    request: AcpWriteTextFileRequest,
  ): Promise<Record<string, never>> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, request.content, 'utf-8');
    return {};
  }

  private resolveSessionPath(sessionId: string, rawPath: string): string {
    const cwd = this.sessionCwds.get(sessionId)
      ?? getVaultPath(this.plugin.app)
      ?? process.cwd();
    const resolvedPath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(cwd, rawPath);
    if (!isPathWithinDirectory(resolvedPath, cwd, cwd)) {
      throw new Error('Kimi file access is limited to the current workspace.');
    }
    return resolvedPath;
  }

  private formatRuntimeError(error: unknown): string {
    if (isKimiAuthRequiredError(error)) {
      return KIMI_AUTH_REQUIRED_MESSAGE;
    }
    const baseMessage = error instanceof Error ? error.message : 'Kimi request failed';
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${baseMessage}\n\n${stderr}` : baseMessage;
  }

  private clearActiveSession(): void {
    this.sessionId = null;
    this.loadedSessionId = null;
    this.currentSessionModelId = null;
    this.setSupportedCommands([]);
  }
}

export const KIMI_AUTH_REQUIRED_MESSAGE = 'Kimi is not logged in. Run `kimi login` in your terminal and try again.';

function isKimiAuthRequiredError(error: unknown): boolean {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === KIMI_AUTH_REQUIRED_ERROR_CODE
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('AUTH_REQUIRED') || message.includes('not logged in');
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function sameDiscoveredModels(
  left: Array<{ rawId: string; label: string; description?: string }>,
  right: Array<{ rawId: string; label: string; description?: string }>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((model, index) => (
    model.rawId === right[index]?.rawId
    && model.label === right[index]?.label
    && (model.description ?? '') === (right[index]?.description ?? '')
  ));
}
