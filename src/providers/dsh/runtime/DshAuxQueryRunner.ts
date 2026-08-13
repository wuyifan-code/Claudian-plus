import * as path from 'node:path';

import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { getVaultPath } from '../../../utils/path';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  selectPermissionOption,
} from '../../acp';
import { DshMcpServerManager } from '../app/DshMcpServerManager';
import { ensureDshProfile } from '../app/DshProfileProvisioner';
import { getDshProviderSettings } from '../settings';
import { prepareDshLaunchArtifacts } from './DshLaunchArtifacts';
import { buildDshRuntimeEnv } from './DshRuntimeEnvironment';

export class DshAuxQueryRunner implements AuxQueryRunner {
  private connection: AcpClientConnection | null = null;
  private currentLaunchKey: string | null = null;
  private process: AcpSubprocess | null = null;
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
      throw new Error('DeepSeek runtime is not ready.');
    }

    if (!this.sessionId) {
      const sessionId = await this.createSession(cwd);
      if (!sessionId) {
        throw new Error('Failed to create a DeepSeek session.');
      }
    }

    const sessionId = this.sessionId!;
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
      const message = error instanceof Error ? error.message : 'DeepSeek request failed';
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
    this.sessionId = null;
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
    const resolvedCliPath = await this.plugin.getResolvedProviderCliPath('dsh') ?? 'dsh';

    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const dshSettings = getDshProviderSettings(settings);
    const runtimeEnv = buildDshRuntimeEnv(settings, resolvedCliPath);
    const skillDirs = [
      path.join(cwd, '.claude', 'skills'),
      path.join(cwd, '.codex', 'skills'),
    ];
    const mcpManager = new DshMcpServerManager(new VaultFileAdapter(this.plugin.app));
    await mcpManager.ensureLoaded();
    const mcpServers = mcpManager.getServers().filter((server) => server.enabled);
    const nextLaunchKey = JSON.stringify({
      command: resolvedCliPath,
      mcp: mcpServers.map((server) => server.name).sort(),
      model: dshSettings.visibleModels[0] ?? 'deepseek-v4-flash',
      profile: dshSettings.profile,
      providerRoute: dshSettings.providerRoute,
      reasoningEffort: dshSettings.reasoningEffort,
      skillDirs,
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
    const provision = await ensureDshProfile(
      dshSettings.profile,
      dshSettings.providerRoute,
    );
    if (provision.status === 'error') {
      throw new Error(provision.error);
    }
    const artifacts = await prepareDshLaunchArtifacts({
      llmModels: dshSettings.discoveredModels
        .filter((model) => model.contextWindow !== undefined)
        .map((model) => ({
          contextWindow: model.contextWindow,
          id: model.rawId,
          label: model.label ?? model.rawId,
        })),
      mcpServers,
      model: dshSettings.visibleModels[0] ?? 'deepseek-v4-flash',
      profile: dshSettings.profile,
      providerRoute: dshSettings.providerRoute,
      reasoningEffort: dshSettings.reasoningEffort,
      skillDirs,
      workspaceRoot: cwd,
    });
    await this.startProcess({
      command: resolvedCliPath,
      cwd,
      patchPath: artifacts.patchPath,
      profile: dshSettings.profile,
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
      this.sessionId = response.sessionId;
      return response.sessionId;
    } catch {
      return null;
    }
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

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian-plus-aux',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    return selectPermissionOption(request.options, ['reject_once', 'reject_always']);
  }
}
