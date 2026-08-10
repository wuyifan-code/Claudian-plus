import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { getEnhancedPath } from '../../utils/env';
import { formatProcessStartError } from '../../utils/processErrors';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../../utils/windowsCmdShim';

const SIGKILL_TIMEOUT_MS = 3_000;
const FINAL_SHUTDOWN_TIMEOUT_MS = 3_000;
const DEFAULT_STDERR_BUFFER_LIMIT = 8_000;

export interface SubprocessLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface SubprocessRunnerOptions {
  /** Provider name used in start-error and exit messages. */
  providerName: string;
  /** Prepend the binary directory to PATH when spawning. */
  enhancePath?: boolean;
  /** Bounded stderr snapshot length. */
  stderrBufferLimit?: number;
  /** stdio mode; arrays are forwarded verbatim to spawn. */
  stdio?: 'pipe' | Array<'pipe' | 'ignore'>;
}

type CloseListener = (error?: Error) => void;
type ExitCallback = (code: number | null, signal: string | null) => void;

/**
 * Shared stdio subprocess wrapper used by provider runtimes.
 *
 * Owns the Windows .cmd shim resolution, bounded stderr snapshot, start-error
 * formatting, close/exit notifications, and the SIGTERM -> SIGKILL -> final
 * shutdown escalation sequence.
 */
export abstract class SubprocessRunner {
  protected proc: ChildProcessWithoutNullStreams | null = null;
  private alive = false;
  private readonly closeListeners = new Set<CloseListener>();
  private readonly exitCallbacks = new Set<ExitCallback>();
  private closeError: Error | null = null;
  private notifiedClose = false;
  private readonly providerName: string;
  private readonly enhancePath: boolean;
  private readonly stdio: 'pipe' | Array<'pipe' | 'ignore'>;
  private readonly stderrBufferLimit: number;
  private resolvedSpawnSpec: WindowsCmdShimSpawnSpec | null = null;
  private stderrBuffer = '';

  constructor(
    protected readonly launchSpec: SubprocessLaunchSpec,
    options: SubprocessRunnerOptions,
  ) {
    this.providerName = options.providerName;
    this.enhancePath = options.enhancePath ?? false;
    this.stderrBufferLimit = options.stderrBufferLimit ?? DEFAULT_STDERR_BUFFER_LIMIT;
    this.stdio = options.stdio ?? 'pipe';
  }

  get stdin(): Writable {
    return this.requireProc().stdin;
  }

  get stdout(): Readable {
    return this.requireProc().stdout;
  }

  get stderr(): Readable {
    return this.requireProc().stderr;
  }

  start(): void {
    if (this.proc) {
      return;
    }

    const resolvedSpawnSpec = resolveWindowsCmdShimSpawnSpec(this.launchSpec);
    this.resolvedSpawnSpec = resolvedSpawnSpec;
    const proc = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
      cwd: this.launchSpec.cwd,
      env: this.buildSpawnEnv(this.launchSpec.env),
      stdio: this.stdio,
      windowsHide: true,
      ...(resolvedSpawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    }) as ChildProcessWithoutNullStreams;

    this.proc = proc;
    this.alive = true;

    proc.stderr?.on('data', (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
      this.stderrBuffer = `${this.stderrBuffer}${text}`.slice(-this.stderrBufferLimit);
    });

    proc.on('error', (error) => {
      this.alive = false;
      const actionableError = formatProcessStartError(error, this.providerName, this.launchSpec.command);
      this.closeError = actionableError;
      this.stderrBuffer = `${this.stderrBuffer}${actionableError.message}`.slice(-this.stderrBufferLimit);
      this.notifyClose(actionableError);
    });

    proc.on('exit', (code, signal) => {
      this.alive = false;
      const exitError = this.closeError ?? (
        code === 0 && signal === null
          ? undefined
          : new Error(`${this.providerName} subprocess exited (${formatExit(code, signal)})`)
      );
      this.notifyClose(exitError);
    });

    proc.on('close', (code, signal) => {
      this.alive = false;
      for (const callback of this.exitCallbacks) {
        try {
          callback(code, signal);
        } catch {
          // Best-effort exit notification.
        }
      }
    });
  }

  isAlive(): boolean {
    return this.alive;
  }

  getStderrSnapshot(): string {
    return this.stderrBuffer.trim();
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  onExit(callback: ExitCallback): void {
    this.exitCallbacks.add(callback);
  }

  offExit(callback: ExitCallback): void {
    this.exitCallbacks.delete(callback);
  }

  async shutdown(): Promise<void> {
    if (!this.proc || !this.alive) {
      return;
    }

    await new Promise<void>((resolve) => {
      const proc = this.proc!;
      let killTimer: number | null = null;
      let finalTimer: number | null = null;
      const onClose = () => {
        cleanup();
        resolve();
      };
      killTimer = window.setTimeout(() => {
        this.killProc(proc, 'SIGKILL');
        finalTimer = window.setTimeout(onClose, FINAL_SHUTDOWN_TIMEOUT_MS);
      }, SIGKILL_TIMEOUT_MS);
      const cleanup = () => {
        if (killTimer !== null) window.clearTimeout(killTimer);
        if (finalTimer !== null) window.clearTimeout(finalTimer);
        proc.off('exit', onClose);
        proc.off('error', onClose);
      };

      proc.once('exit', onClose);
      // A failed executable may emit only `error`; teardown must still finish
      // instead of waiting through both kill timers.
      proc.once('error', onClose);
      this.killProc(proc, 'SIGTERM');
    });
  }

  protected buildSpawnEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    if (!this.enhancePath) {
      return baseEnv;
    }

    return {
      ...baseEnv,
      PATH: getEnhancedPath(
        baseEnv.PATH,
        path.isAbsolute(this.launchSpec.command) ? this.launchSpec.command : undefined,
      ),
    };
  }

  private killProc(proc: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): boolean {
    return terminateSpawnedProcess(proc, signal, spawn, this.resolvedSpawnSpec);
  }

  private notifyClose(error?: Error): void {
    if (this.notifiedClose) {
      return;
    }

    this.notifiedClose = true;
    for (const listener of this.closeListeners) {
      try {
        listener(error);
      } catch {
        // Best-effort cleanup notification.
      }
    }
  }

  private requireProc(): ChildProcessWithoutNullStreams {
    if (!this.proc) {
      throw new Error(`${this.providerName} subprocess is not started`);
    }
    return this.proc;
  }
}

function formatExit(code: number | null, signal: string | null): string {
  if (signal) {
    return `signal ${signal}`;
  }
  if (code === null) {
    return 'unknown';
  }
  return `code ${code}`;
}
