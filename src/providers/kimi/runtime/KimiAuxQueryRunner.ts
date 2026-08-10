import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { getVaultPath, isPathWithinDirectory } from '../../../utils/path';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  extractAcpSessionModelState,
  selectPermissionOption,
} from '../../acp';
import { decodeKimiModelId } from '../models';
import { kimiChatUIConfig } from '../ui/KimiChatUIConfig';
import { buildKimiRuntimeEnv } from './KimiRuntimeEnvironment';

export class KimiAuxQueryRunner implements AuxQueryRunner {
  private availableModelIds = new Set<string>();
  private connection: AcpClientConnection | null = null;
  private currentModelId: string | null = null;
  private currentLaunchKey: string | null = null;
  private process: AcpSubprocess | null = null;
  private readonly sessionCwds = new Map<string, string>();
  private sessionId: string | null = null;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private transport: AcpJsonRpcTransport | null = null;

  constructor(
    private readonly plugin: ProviderHost,
  ) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    await this.ensureReady(cwd);

    if (!this.connection) {
      throw new Error('Kimi runtime is not ready.');
    }

    if (!this.sessionId) {
      const sessionId = await this.createSession(cwd);
      if (!sessionId) {
        throw new Error('Failed to create a Kimi session.');
      }
    }

    const sessionId = this.sessionId!;
    const selectedModel = this.resolveSelectedRawModel(config.model);
    const nextModel = this.resolveApplicableModel(selectedModel);
    if (nextModel) {
      try {
        await this.connection.setModel({
          modelId: nextModel,
          sessionId,
        });
        this.currentModelId = nextModel;
      } catch {
        // Model switching is best-effort for auxiliary tasks.
      }
    }

    this.sessionUpdateNormalizer.reset();
    let accumulatedText = '';
    const removeListener = this.connection.onSessionNotification((notification) => {
      if (notification.sessionId !== sessionId) {
        return;
      }

      const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
      if (normalized.type !== 'message_chunk' || normalized.role !== 'assistant') {
        return;
      }

      for (const chunk of normalized.streamChunks) {
        if (chunk.type !== 'text') {
          continue;
        }

        accumulatedText += chunk.content;
        config.onTextChunk?.(accumulatedText);
      }
    });

    const abortHandler = () => {
      if (this.connection && this.sessionId) {
        this.connection.cancel({ sessionId: this.sessionId });
      }
    };
    config.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

    try {
      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }

      await this.connection.prompt({
        prompt: [{ type: 'text', text: prompt }],
        sessionId,
      });

      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }

      return accumulatedText;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kimi request failed';
      const stderr = this.process?.getStderrSnapshot();
      throw new Error(
        stderr ? `${message}\n\n${stderr}` : message,
        error instanceof Error ? { cause: error } : undefined,
      );
    } finally {
      config.abortController?.signal.removeEventListener('abort', abortHandler);
      removeListener();
    }
  }

  reset(): void {
    this.availableModelIds.clear();
    this.sessionId = null;
    this.sessionCwds.clear();
    this.currentModelId = null;
    this.currentLaunchKey = null;
    this.connection?.dispose();
    this.connection = null;
    this.transport?.dispose();
    this.transport = null;
    if (this.process) {
      void this.process.shutdown().catch(() => {});
    }
    this.process = null;
    this.sessionUpdateNormalizer.reset();
  }

  private async ensureReady(cwd: string): Promise<void> {
    const resolvedCliPath = await this.plugin.getResolvedProviderCliPath('kimi') ?? 'kimi';

    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const runtimeEnv = buildKimiRuntimeEnv(settings, resolvedCliPath);
    const nextLaunchKey = JSON.stringify({
      command: resolvedCliPath,
      envText: runtimeEnv.PATH,
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || this.currentLaunchKey !== nextLaunchKey;

    if (!shouldRestart) {
      return;
    }

    this.reset();
    await this.startProcess({
      command: resolvedCliPath,
      cwd,
      runtimeEnv,
    });
    this.currentLaunchKey = nextLaunchKey;
  }

  private async createSession(cwd: string): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    try {
      const response = await this.connection.newSession({
        cwd,
        mcpServers: [],
      });
      this.syncSessionModelState({
        models: response.models ?? null,
      });
      this.sessionId = response.sessionId;
      this.sessionCwds.set(response.sessionId, cwd);
      return response.sessionId;
    } catch {
      return null;
    }
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

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian-plus-aux',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        fileSystem: {
          readTextFile: (request) => this.readTextFile(request),
        },
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
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

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    return selectPermissionOption(request.options, ['reject_once', 'reject_always']);
  }

  private resolveSelectedRawModel(explicitModel?: string): string | undefined {
    const projectedSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'kimi',
    );
    if (explicitModel) {
      const trimmed = explicitModel.trim();
      if (!trimmed) {
        return undefined;
      }
      return kimiChatUIConfig.ownsModel(trimmed, projectedSettings)
        ? decodeKimiModelId(trimmed) ?? undefined
        : trimmed;
    }

    const selectedModel = typeof projectedSettings.model === 'string'
      ? projectedSettings.model
      : '';
    return kimiChatUIConfig.ownsModel(selectedModel, projectedSettings)
      ? decodeKimiModelId(selectedModel) ?? undefined
      : undefined;
  }

  private resolveApplicableModel(selectedModel: string | undefined): string | null {
    if (!selectedModel) {
      return null;
    }
    if (selectedModel === this.currentModelId) {
      return null;
    }
    if (this.availableModelIds.size === 0) {
      return selectedModel;
    }
    return this.availableModelIds.has(selectedModel)
      ? selectedModel
      : null;
  }

  private syncSessionModelState(params: {
    models?: Parameters<typeof extractAcpSessionModelState>[0]['models'];
  }): void {
    const state = extractAcpSessionModelState(params);
    this.currentModelId = state.currentModelId;
    this.availableModelIds = new Set(state.availableModels.map((model) => model.id));
  }

  private resolveSessionPath(sessionId: string, rawPath: string): string {
    const cwd = this.sessionCwds.get(sessionId)
      ?? getVaultPath(this.plugin.app)
      ?? process.cwd();
    const resolvedPath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(cwd, rawPath);
    if (!isPathWithinDirectory(resolvedPath, cwd, cwd)) {
      throw new Error('Kimi aux read access is limited to the current workspace.');
    }
    return resolvedPath;
  }
}
