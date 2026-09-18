import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { ChatRuntimeConversationState, PreparedChatTurn } from '@/core/runtime/types';
import type { ChatTurnRequest } from '@/core/runtime/types';
import type { Conversation, StreamChunk } from '@/core/types';
import { AntigravityConversationHistoryService } from '@/providers/antigravity/history/AntigravityConversationHistoryService';
import type { AntigravitySubprocessHandle } from '@/providers/antigravity/runtime/AntigravityChatRuntime';
import {
  AntigravityChatRuntime,
  createAntigravityChatRuntime,
} from '@/providers/antigravity/runtime/AntigravityChatRuntime';
import type { AntigravitySubprocessLaunchSpec } from '@/providers/antigravity/runtime/AntigravitySubprocess';
import { getAntigravityProviderSettings } from '@/providers/antigravity/settings';
import {
  ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
  readAntigravitySessionState,
  writeAntigravitySessionState,
} from '@/providers/antigravity/types';

type ExitCallback = (code: number | null, signal: string | null) => void;
type CloseListener = (error?: Error) => void;

/**
 * Offline stand-in for `AntigravitySubprocess`. It reproduces the public surface
 * the runtime consumes from the shared `SubprocessRunner` (stdout as a byte
 * async-iterable, exit/close notification, shutdown escalation hook) and lets
 * each test script records and process exits without spawning anything.
 */
class FakeAntigravitySubprocess implements AntigravitySubprocessHandle {
  readonly spec: AntigravitySubprocessLaunchSpec;
  readonly start = jest.fn(() => {
    this.started = true;
  });
  readonly shutdown = jest.fn(async () => {
    this.notifyExit(1, null);
    this.endStdout();
  });
  readonly getStderrSnapshot = jest.fn(() => this.stderrText);

  private started = false;
  private readonly closeListeners = new Set<CloseListener>();
  private readonly exitCallbacks = new Set<ExitCallback>();
  private readonly pendingChunks: Uint8Array[] = [];
  private stdoutWaiter: (() => void) | null = null;
  private stdoutEnded = false;
  private stderrText = '';
  private exited = false;
  private alive = true;

  constructor(spec: AntigravitySubprocessLaunchSpec) {
    this.spec = spec;
  }

  get wasStarted(): boolean {
    return this.started;
  }

  isAlive(): boolean {
    return this.alive;
  }

  readonly stdout: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => this.iterateStdout(),
  };

  private async *iterateStdout(): AsyncGenerator<Uint8Array, void, undefined> {
    while (true) {
      if (this.pendingChunks.length > 0) {
        yield this.pendingChunks.shift()!;
        continue;
      }
      if (this.stdoutEnded) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.stdoutWaiter = resolve;
      });
      this.stdoutWaiter = null;
    }
  }

  onExit(callback: ExitCallback): void {
    this.exitCallbacks.add(callback);
    if (this.exited) {
      callback(null, null);
    }
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /** Emits one NDJSON record on stdout. */
  emit(record: unknown): void {
    const line = `${JSON.stringify(record)}\n`;
    this.pendingChunks.push(new TextEncoder().encode(line));
    this.stdoutWaiter?.();
  }

  /** Sets the bounded stderr snapshot the runtime surfaces in failure details. */
  setStderr(text: string): void {
    this.stderrText = text;
  }

  endStdout(): void {
    this.stdoutEnded = true;
    this.stdoutWaiter?.();
  }

  /**
   * Simulates a process exit with the real SubprocessRunner ordering: the close
   * listeners observe a derived error first, then the exit callbacks receive the
   * actual code/signal.
   */
  notifyExit(code: number | null, signal: string | null): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.alive = false;
    const closeError = code === 0 && signal === null
      ? undefined
      : new Error(`Antigravity subprocess exited (${signal ? `signal ${signal}` : `code ${code}`})`);
    for (const listener of [...this.closeListeners]) {
      listener(closeError);
    }
    for (const callback of [...this.exitCallbacks]) {
      callback(code, signal);
    }
  }

  /** Simulates a spawn/start failure: close fires with an error, no records exist. */
  failSpawn(message: string): void {
    this.alive = false;
    this.endStdout();
    for (const listener of [...this.closeListeners]) {
      listener(new Error(message));
    }
    for (const callback of [...this.exitCallbacks]) {
      callback(null, null);
    }
  }

  /** Plays a full successful turn (init → delta → result) and exits cleanly. */
  playSuccessfulTurn(conversationId: string, responseText: string, resumeDelta: string | null = null): void {
    this.emit(makeInitEvent(conversationId));
    this.emit(makeDeltaEvent(conversationId, 1, responseText, 'ACTIVE'));
    if (resumeDelta !== null) {
      this.emit(makeDeltaEvent(conversationId, 1, resumeDelta, 'DONE'));
    }
    this.emit(makeResultEvent(conversationId, resumeDelta === null ? responseText : `${responseText}${resumeDelta}`));
    this.endStdout();
    this.notifyExit(0, null);
  }

  /** Plays a turn with one completed tool step, then assistant text and a clean exit. */
  playToolTurn(conversationId: string, toolStepIndex: number, responseText: string): void {
    this.emit(makeInitEvent(conversationId));
    this.emit(makeToolEvent(conversationId, toolStepIndex));
    this.emit(makeDeltaEvent(conversationId, toolStepIndex + 1, responseText, 'DONE'));
    this.emit(makeResultEvent(conversationId, responseText));
    this.endStdout();
    this.notifyExit(0, null);
  }
}

function makeInitEvent(conversationId: string): Record<string, unknown> {
  return {
    event: 'init',
    conversation_id: conversationId,
    init: {
      model: 'gemini-3.8-flash-low',
      cwd: 'D:/vault',
      tools: [],
      permission_mode: 'request-review',
    },
  };
}

function makeDeltaEvent(
  conversationId: string,
  stepIndex: number,
  textDelta: string,
  state: 'ACTIVE' | 'DONE',
): Record<string, unknown> {
  return {
    event: 'step_update',
    step_update: {
      conversation_id: conversationId,
      step_index: stepIndex,
      state,
      step_type: 'agent_response',
      text_delta: textDelta,
    },
  };
}

function makeResultEvent(
  conversationId: string,
  response: string,
  status = 'SUCCESS',
): Record<string, unknown> {
  return {
    event: 'result',
    result: {
      conversation_id: conversationId,
      status,
      response,
      duration_seconds: 0.5,
      num_turns: 1,
      usage: { input_tokens: 10, output_tokens: 2, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 12 },
    },
  };
}

function makeToolEvent(conversationId: string, stepIndex: number): Record<string, unknown> {
  return {
    event: 'step_update',
    step_update: {
      conversation_id: conversationId,
      step_index: stepIndex,
      state: 'DONE',
      step_type: 'tool',
      tool_info: { name: 'run_command', parameters: { command: 'dir' }, output: 'listing' },
    },
  };
}

interface RuntimeHarness {
  runtime: AntigravityChatRuntime;
  fakes: FakeAntigravitySubprocess[];
  plugin: ProviderHost;
  settings: Record<string, unknown>;
}

interface HarnessOptions {
  enabled?: boolean;
  providerConfigOverrides?: Record<string, unknown>;
  resolveCliPath?: () => Promise<string | null> | string | null;
  /**
   * Builds the runtime through the shipped provider factory instead of the
   * bare constructor, so the real replay-cache recorder is wired in. Requires a
   * real `vaultPath`; the bare constructor records no history.
   */
  useProviderFactory?: boolean;
  /** Vault base path; defaults to the inert `D:/vault` used by most tests. */
  vaultPath?: string;
  /** Makes the settings write fail, to prove diagnostics never break a turn. */
  settingsWriteFails?: boolean;
}

function createHarness(options: HarnessOptions = {}): RuntimeHarness {
  const settings: Record<string, unknown> = {
    providerConfigs: {
      antigravity: {
        enabled: options.enabled ?? true,
        cliPath: 'C:/fake/agy.cmd',
        timeoutMs: 5_000,
        environmentVariables: '',
        manualModelId: '',
        ...(options.providerConfigOverrides ?? {}),
      },
    },
  };
  const saveSettings = jest.fn(async () => {
    if (options.settingsWriteFails) {
      throw new Error('settings write failed');
    }
  });
  const plugin = {
    app: { vault: { adapter: { basePath: options.vaultPath ?? 'D:/vault' } } },
    settings,
    storage: {},
    saveSettings,
    // Mirrors the host: the mutation is applied to the live bag, then persisted.
    mutateSettings: jest.fn(async (mutation: (current: Record<string, unknown>) => void | Promise<void>) => {
      await mutation(settings);
      await saveSettings();
    }),
    mutateSettingsConditionally: jest.fn(),
    loadData: jest.fn(async () => null),
    saveData: jest.fn(async () => {}),
    normalizeModelVariantSettings: jest.fn(() => false),
    getActiveEnvironmentVariables: jest.fn(() => ''),
    getEnvironmentVariablesForScope: jest.fn(() => ''),
    applyEnvironmentVariables: jest.fn(async () => {}),
    applyEnvironmentVariablesBatch: jest.fn(async () => {}),
    getResolvedProviderCliPath: jest.fn(async () => 'C:/fake/agy.cmd'),
    getMemoryInjectionText: jest.fn(async () => null),
    getConsciousnessInjectionText: jest.fn(async () => null),
  } as unknown as ProviderHost;

  const fakes: FakeAntigravitySubprocess[] = [];
  const resolveCliPath = options.resolveCliPath ?? (async () => 'C:/fake/agy.cmd');
  const createSubprocess = (spec: AntigravitySubprocessLaunchSpec): FakeAntigravitySubprocess => {
    const fake = new FakeAntigravitySubprocess(spec);
    fakes.push(fake);
    return fake;
  };
  const runtime = options.useProviderFactory
    ? createAntigravityChatRuntime(plugin, { resolveCliPath, createSubprocess })
    : new AntigravityChatRuntime(plugin, { resolveCliPath, createSubprocess });
  return { runtime, fakes, plugin, settings };
}

function makeConversation(
  id: string,
  providerState?: Record<string, unknown>,
  selectedModel?: string,
): Conversation {
  return {
    id,
    providerId: 'antigravity',
    title: `Conversation ${id}`,
    createdAt: 0,
    updatedAt: 0,
    sessionId: null,
    messages: [],
    ...(providerState ? { providerState } : {}),
    ...(selectedModel ? { selectedModel } : {}),
  };
}

function syncConversation(runtime: AntigravityChatRuntime, conversation: Conversation | null): void {
  const state: ChatRuntimeConversationState | null = conversation
    ? {
      id: conversation.id,
      sessionId: conversation.sessionId,
      providerState: conversation.providerState,
      selectedModel: conversation.selectedModel,
    }
    : null;
  runtime.syncConversationState(state);
}

function makeTurn(text: string): PreparedChatTurn {
  return {
    request: { text } as ChatTurnRequest,
    persistedContent: '',
    prompt: text,
    isCompact: false,
    mcpMentions: new Set<string>(),
  };
}

async function collect(generator: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }
  return chunks;
}

const flush = async (): Promise<void> => {
  for (let round = 0; round < 8; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

/**
 * Waits until the runtime has constructed its Nth subprocess. Replay-cache
 * writes are real filesystem I/O, so a fixed number of event-loop turns is not
 * a reliable barrier for these tests.
 */
async function waitForSubprocesses(
  fakes: FakeAntigravitySubprocess[],
  expected: number,
): Promise<void> {
  const startedAt = Date.now();
  while (fakes.length < expected) {
    if (Date.now() - startedAt > 5_000) {
      throw new Error(`expected ${expected} Antigravity subprocess(es), saw ${fakes.length}`);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await flush();
}

function chunkTypes(chunks: StreamChunk[]): string[] {
  return chunks.map((chunk) => chunk.type);
}

function textOf(chunks: StreamChunk[]): string {
  return chunks
    .filter((chunk): chunk is Extract<StreamChunk, { type: 'text' }> => chunk.type === 'text')
    .map((chunk) => chunk.content)
    .join('');
}

function errorContentOf(chunks: StreamChunk[]): string {
  const error = chunks.find(
    (chunk): chunk is Extract<StreamChunk, { type: 'error' }> => chunk.type === 'error',
  );
  return error?.content ?? '';
}

describe('AntigravityChatRuntime', () => {
  describe('two mock subprocesses running in parallel', () => {
    it('keeps concurrent tab streams and session bindings isolated', async () => {
      const harnessA = createHarness();
      const harnessB = createHarness();
      syncConversation(harnessA.runtime, makeConversation('tab-a'));
      syncConversation(harnessB.runtime, makeConversation('tab-b'));

      const queryA = collect(harnessA.runtime.query(makeTurn('Prompt A')));
      const queryB = collect(harnessB.runtime.query(makeTurn('Prompt B')));
      await flush();

      expect(harnessA.fakes).toHaveLength(1);
      expect(harnessB.fakes).toHaveLength(1);
      harnessA.fakes[0].playSuccessfulTurn('conv-aaa', 'Answer A');
      harnessB.fakes[0].playSuccessfulTurn('conv-bbb', 'Answer B');

      const [chunksA, chunksB] = await Promise.all([queryA, queryB]);

      expect(textOf(chunksA)).toBe('Answer A');
      expect(textOf(chunksB)).toBe('Answer B');
      expect(textOf(chunksA)).not.toContain('Answer B');
      expect(textOf(chunksB)).not.toContain('Answer A');
      expect(chunkTypes(chunksA)).toEqual(['text', 'usage', 'done']);
      expect(chunkTypes(chunksB)).toEqual(['text', 'usage', 'done']);
      expect(harnessA.runtime.isReady()).toBe(true);
      expect(harnessB.runtime.isReady()).toBe(true);

      const conversationA = makeConversation('tab-a');
      const updatesA = harnessA.runtime.buildSessionUpdates({ conversation: conversationA, sessionInvalidated: false });
      const conversationB = makeConversation('tab-b');
      const updatesB = harnessB.runtime.buildSessionUpdates({ conversation: conversationB, sessionInvalidated: false });
      expect(readAntigravitySessionState(conversationA)?.conversationId).toBe('conv-aaa');
      expect(readAntigravitySessionState(conversationB)?.conversationId).toBe('conv-bbb');
      expect(updatesA.updates.sessionId).toBe('conv-aaa');
      expect(updatesB.updates.sessionId).toBe('conv-bbb');
    });
  });

  describe('stop-then-send (cancel, then resume by verified conversation id)', () => {
    it('terminates the in-flight process and resumes the next turn with --conversation', async () => {
      const { runtime, fakes } = createHarness();
      syncConversation(runtime, makeConversation('tab-a'));

      const generator = runtime.query(makeTurn('Long running prompt'));
      const firstChunk = generator.next();
      await flush();
      expect(fakes).toHaveLength(1);
      expect(fakes[0].spec.args).not.toContain('--conversation');

      fakes[0].emit(makeInitEvent('conv-cancelled'));
      fakes[0].emit(makeDeltaEvent('conv-cancelled', 1, 'Partial ', 'ACTIVE'));
      await flush();

      runtime.cancel();
      const chunks: StreamChunk[] = [(await firstChunk).value];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(fakes[0].shutdown).toHaveBeenCalled();
      expect(chunkTypes(chunks)).toEqual(['text', 'notice', 'done']);
      await flush();

      const resumedQuery = collect(runtime.query(makeTurn('Second prompt')));
      await flush();
      expect(fakes).toHaveLength(2);
      fakes[1].playSuccessfulTurn('conv-cancelled', 'Partial ', 'resume answer');
      const resumedChunks = await resumedQuery;

      expect(fakes[1].spec.args).toContain('--conversation');
      expect(fakes[1].spec.args[fakes[1].spec.args.indexOf('--conversation') + 1]).toBe('conv-cancelled');
      expect(textOf(resumedChunks)).toBe('Partial resume answer');

      const conversation = makeConversation('tab-a');
      runtime.buildSessionUpdates({ conversation, sessionInvalidated: false });
      expect(readAntigravitySessionState(conversation)).toEqual({
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv-cancelled',
        turnCount: 1,
      });
    });
  });

  it('rejects a second concurrent query instead of interleaving turns', async () => {
    const { runtime, fakes } = createHarness();
    syncConversation(runtime, makeConversation('tab-a'));

    const firstQuery = runtime.query(makeTurn('First'));
    const firstChunk = firstQuery.next();
    await flush();
    expect(fakes).toHaveLength(1);

    const secondChunks = await collect(runtime.query(makeTurn('Second')));
    expect(chunkTypes(secondChunks)).toEqual(['error', 'done']);
    expect(errorContentOf(secondChunks)).toContain('already in progress');
    expect(fakes).toHaveLength(1);

    fakes[0].playSuccessfulTurn('conv-first', 'First answer');
    const firstResult = await firstChunk;
    const restChunks = await collect(firstQuery);
    expect(textOf([firstResult.value, ...restChunks])).toBe('First answer');
  });

  describe('cancel during prepare', () => {
    it('never spawns a process and leaves the runtime usable', async () => {
      let resolveCliPathValue: ((value: string | null) => void) | null = null;
      const cliPathPromise = new Promise<string | null>((resolve) => {
        resolveCliPathValue = resolve;
      });
      const resolveCliPath = jest.fn()
        .mockReturnValueOnce(cliPathPromise)
        .mockResolvedValue('C:/fake/agy.cmd');
      const { runtime, fakes } = createHarness({ resolveCliPath });
      syncConversation(runtime, makeConversation('tab-a'));

      const generator = runtime.query(makeTurn('Cancelled while preparing'));
      const firstChunk = generator.next();
      await flush();
      expect(fakes).toHaveLength(0);

      runtime.cancel();
      resolveCliPathValue!('C:/fake/agy.cmd');
      await flush();

      const chunks: StreamChunk[] = [(await firstChunk).value];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }
      expect(chunkTypes(chunks)).toEqual(['notice', 'done']);
      expect(fakes).toHaveLength(0);

      const secondQuery = collect(runtime.query(makeTurn('Follow up')));
      await flush();
      expect(fakes).toHaveLength(1);
      fakes[0].playSuccessfulTurn('conv-after-cancel', 'Recovered');
      const secondChunks = await secondQuery;
      expect(textOf(secondChunks)).toBe('Recovered');
      expect(chunkTypes(secondChunks)).toEqual(['text', 'usage', 'done']);
    });
  });

  describe('init failure', () => {
    it('surfaces a spawn failure as an error chunk without recording session state', async () => {
      const { runtime, fakes } = createHarness();
      syncConversation(runtime, makeConversation('tab-a'));

      const query = collect(runtime.query(makeTurn('Prompt')));
      await flush();
      expect(fakes).toHaveLength(1);
      fakes[0].failSpawn('spawn ENOENT');

      const chunks = await query;
      expect(chunkTypes(chunks)).toEqual(['error', 'done']);
      expect(errorContentOf(chunks)).toContain('spawn ENOENT');
      expect(runtime.isReady()).toBe(false);

      const conversation = makeConversation('tab-a');
      const updates = runtime.buildSessionUpdates({ conversation, sessionInvalidated: false });
      expect(updates.updates.providerState).toBeUndefined();
      expect(readAntigravitySessionState(conversation)).toBeNull();
    });

    it('surfaces a missing CLI as a typed error', async () => {
      const { runtime, fakes } = createHarness({ resolveCliPath: async () => null });
      syncConversation(runtime, makeConversation('tab-a'));

      const chunks = await collect(runtime.query(makeTurn('Prompt')));
      expect(chunkTypes(chunks)).toEqual(['error', 'done']);
      expect(errorContentOf(chunks)).toContain('agy');
      expect(fakes).toHaveLength(0);
    });
  });

  describe('last startup failure recording', () => {
    it('records a spawn failure as a bounded entry with a redacted detail', async () => {
      const harness = createHarness();
      syncConversation(harness.runtime, makeConversation('tab-a'));

      const query = collect(harness.runtime.query(makeTurn('Prompt')));
      await flush();
      harness.fakes[0].failSpawn('spawn ENOENT C:\\Users\\ada\\agy.EXE');
      await query;

      const recorded = getAntigravityProviderSettings(harness.settings).lastFailure;
      expect(recorded?.category).toBe('spawn-failed');
      expect(recorded?.detail).toContain('ENOENT');
      expect(recorded?.recordedAt).toBeGreaterThan(0);

      // Bounded: one entry in the provider config, never a growing list.
      const config = (harness.settings.providerConfigs as Record<string, Record<string, unknown>>).antigravity;
      expect(Array.isArray(config.lastFailure)).toBe(false);
      expect(JSON.stringify(config.lastFailure)).not.toContain('ada');
    });

    it('records a missing CLI without leaking a path', async () => {
      const harness = createHarness({ resolveCliPath: async () => null });
      syncConversation(harness.runtime, makeConversation('tab-a'));

      const chunks = await collect(harness.runtime.query(makeTurn('Prompt')));

      expect(chunkTypes(chunks)).toEqual(['error', 'done']);
      expect(harness.fakes).toHaveLength(0);
      const recorded = getAntigravityProviderSettings(harness.settings).lastFailure;
      expect(recorded?.category).toBe('cli-missing');
      expect(recorded?.detail).toBeUndefined();
    });

    it('records a timeout when the watchdog terminates the process', async () => {
      const harness = createHarness({ providerConfigOverrides: { timeoutMs: 10 } });
      syncConversation(harness.runtime, makeConversation('tab-a'));

      const chunks = await collect(harness.runtime.query(makeTurn('Prompt')));

      expect(errorContentOf(chunks)).toContain('timed out');
      expect(getAntigravityProviderSettings(harness.settings).lastFailure?.category).toBe('timeout');
    });

    it('overwrites the previous failure so only the most recent one is kept', async () => {
      let resolvedPath: string | null = null;
      const harness = createHarness({ resolveCliPath: () => resolvedPath });
      syncConversation(harness.runtime, makeConversation('tab-a'));

      await collect(harness.runtime.query(makeTurn('First')));
      expect(getAntigravityProviderSettings(harness.settings).lastFailure?.category).toBe('cli-missing');

      resolvedPath = 'C:/fake/agy.cmd';
      const secondQuery = collect(harness.runtime.query(makeTurn('Second')));
      await flush();
      harness.fakes[0].failSpawn('spawn ENOENT');
      await secondQuery;

      const recorded = getAntigravityProviderSettings(harness.settings).lastFailure;
      expect(recorded?.category).toBe('spawn-failed');
      expect(recorded?.detail).toBe('spawn ENOENT');
      const config = (harness.settings.providerConfigs as Record<string, Record<string, unknown>>).antigravity;
      expect(Object.keys(config).filter((key) => key === 'lastFailure')).toHaveLength(1);
    });

    it('never lets a failed settings write break the turn', async () => {
      const harness = createHarness({ settingsWriteFails: true });
      syncConversation(harness.runtime, makeConversation('tab-a'));

      const query = collect(harness.runtime.query(makeTurn('Prompt')));
      await flush();
      harness.fakes[0].failSpawn('spawn ENOENT');
      const chunks = await query;

      expect(chunkTypes(chunks)).toEqual(['error', 'done']);
      expect(errorContentOf(chunks)).toContain('spawn ENOENT');
    });

    it('leaves the record untouched when a turn succeeds', async () => {
      const harness = createHarness();
      syncConversation(harness.runtime, makeConversation('tab-a'));

      const query = collect(harness.runtime.query(makeTurn('Prompt')));
      await flush();
      harness.fakes[0].playSuccessfulTurn('conv-ok', 'Answer');
      await query;

      expect(getAntigravityProviderSettings(harness.settings).lastFailure).toBeNull();
    });

    it('records an init failure when the CLI exits before binding a conversation', async () => {
      const harness = createHarness();
      syncConversation(harness.runtime, makeConversation('tab-a'));

      const query = collect(harness.runtime.query(makeTurn('Prompt')));
      await flush();
      harness.fakes[0].endStdout();
      harness.fakes[0].notifyExit(0, null);
      await query;

      const recorded = getAntigravityProviderSettings(harness.settings).lastFailure;
      expect(recorded?.category).toBe('init-failed');
      // No result and no stderr detail: the record stays category-only.
      expect(recorded?.detail).toBeUndefined();
    });

    it('records a malformed stream once a conversation was bound but no result arrived', async () => {
      const harness = createHarness();
      syncConversation(harness.runtime, makeConversation('tab-a'));

      const query = collect(harness.runtime.query(makeTurn('Prompt')));
      await flush();
      harness.fakes[0].emit(makeInitEvent('conv-half'));
      await flush();
      harness.fakes[0].endStdout();
      harness.fakes[0].notifyExit(0, null);
      await query;

      expect(getAntigravityProviderSettings(harness.settings).lastFailure?.category)
        .toBe('malformed-stream');
    });

    it('does not record a user cancellation as a startup failure', async () => {
      const harness = createHarness();
      syncConversation(harness.runtime, makeConversation('tab-a'));

      const generator = harness.runtime.query(makeTurn('Long prompt'));
      const firstChunk = generator.next();
      await flush();
      harness.fakes[0].emit(makeInitEvent('conv-cancelled'));
      await flush();

      harness.runtime.cancel();
      const chunks: StreamChunk[] = [(await firstChunk).value];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunkTypes(chunks)).toContain('done');
      expect(getAntigravityProviderSettings(harness.settings).lastFailure).toBeNull();
    });
  });

  describe('cleanup called twice', () => {
    it('shuts the process down once and stays idempotent', async () => {
      const { runtime, fakes } = createHarness();
      syncConversation(runtime, makeConversation('tab-a'));

      const generator = runtime.query(makeTurn('Prompt'));
      const firstChunk = generator.next();
      await flush();
      expect(fakes).toHaveLength(1);

      runtime.cleanup();
      runtime.cleanup();
      await flush();

      expect(fakes[0].shutdown).toHaveBeenCalledTimes(1);
      const chunks: StreamChunk[] = [(await firstChunk).value];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }
      expect(chunkTypes(chunks)).toEqual(['notice', 'done']);
      expect(fakes).toHaveLength(1);
    });
  });

  describe('switching conversations', () => {
    it('binds each launch to the switched conversation state', async () => {
      const { runtime, fakes } = createHarness();
      const conversationA = makeConversation('tab-a');
      writeAntigravitySessionState(conversationA, {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv-persisted-a',
        turnCount: 2,
      });
      syncConversation(runtime, conversationA);

      const queryA = collect(runtime.query(makeTurn('Turn for A')));
      await flush();
      fakes[0].playSuccessfulTurn('conv-persisted-a', 'Answer A');
      const chunksA = await queryA;
      expect(textOf(chunksA)).toBe('Answer A');
      expect(fakes[0].spec.args).toContain('--conversation');
      expect(fakes[0].spec.args[fakes[0].spec.args.indexOf('--conversation') + 1]).toBe('conv-persisted-a');

      // While conversation A is still the bound conversation, the settled turn
      // increments its persisted turn count.
      const updatesAWhileBound = runtime.buildSessionUpdates({ conversation: conversationA, sessionInvalidated: false });
      expect(readAntigravitySessionState(conversationA)).toEqual({
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv-persisted-a',
        turnCount: 3,
      });
      expect(updatesAWhileBound.updates.sessionId).toBe('conv-persisted-a');

      syncConversation(runtime, makeConversation('tab-b'));
      const queryB = collect(runtime.query(makeTurn('Turn for B')));
      await flush();
      expect(fakes[1].spec.args).not.toContain('--conversation');
      fakes[1].playSuccessfulTurn('conv-new-b', 'Answer B');
      const chunksB = await queryB;
      expect(textOf(chunksB)).toBe('Answer B');

      // Conversation A is no longer bound: the runtime must not write B's state
      // into A (or A's stale in-memory state anywhere at all).
      const staleUpdatesA = runtime.buildSessionUpdates({ conversation: conversationA, sessionInvalidated: false });
      expect(staleUpdatesA.updates.providerState).toBeUndefined();
      expect(staleUpdatesA.updates.sessionId).toBeUndefined();

      const conversationB = makeConversation('tab-b');
      runtime.buildSessionUpdates({ conversation: conversationB, sessionInvalidated: false });
      expect(readAntigravitySessionState(conversationB)).toEqual({
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv-new-b',
        turnCount: 1,
      });
    });

    it('starts a fresh session after resetSession', async () => {
      const { runtime, fakes } = createHarness();
      syncConversation(runtime, makeConversation('tab-a'));

      const firstQuery = collect(runtime.query(makeTurn('First')));
      await flush();
      fakes[0].playSuccessfulTurn('conv-first', 'First answer');
      await firstQuery;

      runtime.resetSession();
      expect(runtime.consumeSessionInvalidation()).toBe(true);
      expect(runtime.getSessionId()).toBeNull();

      const secondQuery = collect(runtime.query(makeTurn('Second')));
      await flush();
      expect(fakes[1].spec.args).not.toContain('--conversation');
      fakes[1].playSuccessfulTurn('conv-second', 'Second answer');
      await secondQuery;
      expect(runtime.getSessionId()).toBe('conv-second');
    });
  });

  describe('provider disabled', () => {
    it('yields a clear error without spawning, and cleanup stays safe', async () => {
      const { runtime, fakes } = createHarness({ enabled: false });
      syncConversation(runtime, makeConversation('tab-a'));

      const chunks = await collect(runtime.query(makeTurn('Prompt')));
      expect(chunkTypes(chunks)).toEqual(['error', 'done']);
      expect(errorContentOf(chunks)).toContain('disabled');
      expect(fakes).toHaveLength(0);
      expect(runtime.isReady()).toBe(false);

      expect(() => runtime.cleanup()).not.toThrow();
      runtime.cleanup();
      expect(fakes).toHaveLength(0);
    });
  });

  describe('foreign-session events', () => {
    it('never attributes another conversation event to the current turn', async () => {
      const { runtime, fakes } = createHarness();
      syncConversation(runtime, makeConversation('tab-a'));

      const query = collect(runtime.query(makeTurn('Prompt')));
      await flush();
      const fake = fakes[0];
      fake.emit(makeInitEvent('conv-mine'));
      fake.emit({
        event: 'step_update',
        step_update: {
          conversation_id: 'conv-foreign',
          step_index: 1,
          state: 'ACTIVE',
          step_type: 'agent_response',
          text_delta: 'HIJACKED',
        },
      });
      fake.emit(makeResultEvent('conv-foreign', 'HIJACKED FULL RESPONSE'));
      fake.endStdout();
      fake.notifyExit(0, null);

      const chunks = await query;
      expect(textOf(chunks)).not.toContain('HIJACKED');
      expect(chunkTypes(chunks)).toEqual(['error', 'done']);
      expect(errorContentOf(chunks)).toContain('conversation');

      const conversation = makeConversation('tab-a');
      runtime.buildSessionUpdates({ conversation, sessionInvalidated: false });
      const recordedState = readAntigravitySessionState(conversation);
      expect(recordedState?.conversationId).toBe('conv-mine');
      expect(recordedState?.conversationId).not.toBe('conv-foreign');
      expect(recordedState?.turnCount).toBe(0);
    });
  });

  describe('contract surface', () => {
    it('exposes conservative capabilities and no provider commands', async () => {
      const { runtime } = createHarness();
      expect(runtime.providerId).toBe('antigravity');
      expect(runtime.getCapabilities().supportsPersistentRuntime).toBe(false);
      expect(runtime.getCapabilities().supportsNativeHistory).toBe(false);
      await expect(runtime.getSupportedCommands()).resolves.toEqual([]);
      await expect(runtime.reloadMcpServers()).resolves.toBeUndefined();
      await expect(runtime.rewind('u1', 'a1', 'conversation')).resolves.toEqual({ canRewind: false });
    });

    it('encodes the prompt at prepareTurn time only', () => {
      const { runtime } = createHarness();
      const turn = runtime.prepareTurn({ text: 'Hello there' });
      expect(turn.prompt).toBe('Hello there');
      expect(turn.isCompact).toBe(false);
      expect(turn.persistedContent).toBe('');
      expect(runtime.consumeTurnMetadata()).toEqual({});
    });

    it('reports the confirmed session id and resolves fork session ids', async () => {
      const { runtime, fakes } = createHarness();
      syncConversation(runtime, makeConversation('tab-a'));
      expect(runtime.getSessionId()).toBeNull();

      const query = collect(runtime.query(makeTurn('Prompt')));
      await flush();
      fakes[0].playSuccessfulTurn('conv-confirmed', 'Answer');
      await query;

      expect(runtime.getSessionId()).toBe('conv-confirmed');
      const persisted = makeConversation('tab-a');
      writeAntigravitySessionState(persisted, {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv-persisted',
        turnCount: 4,
      });
      expect(runtime.resolveSessionIdForFork(null)).toBe('conv-confirmed');
      expect(runtime.resolveSessionIdForFork(persisted)).toBe('conv-confirmed');
    });

    it('counts settled successful turns exactly once per turn', async () => {
      const { runtime, fakes } = createHarness();
      syncConversation(runtime, makeConversation('tab-a'));

      const firstQuery = collect(runtime.query(makeTurn('First')));
      await flush();
      fakes[0].playSuccessfulTurn('conv-counted', 'Answer one');
      await firstQuery;

      const secondQuery = collect(runtime.query(makeTurn('Second')));
      await flush();
      fakes[1].playSuccessfulTurn('conv-counted', 'Answer two');
      await secondQuery;

      const conversation = makeConversation('tab-a');
      const updates = runtime.buildSessionUpdates({ conversation, sessionInvalidated: false });
      expect(readAntigravitySessionState(conversation)?.turnCount).toBe(2);
      expect(updates.updates.sessionId).toBe('conv-counted');
    });

    it('keeps unrelated provider keys when writing session state', async () => {
      const { runtime, fakes } = createHarness();
      const conversation = makeConversation('tab-a', { inlineEditState: { keep: true } });
      syncConversation(runtime, conversation);

      const query = collect(runtime.query(makeTurn('Prompt')));
      await flush();
      fakes[0].playSuccessfulTurn('conv-merge', 'Answer');
      await query;

      runtime.buildSessionUpdates({ conversation, sessionInvalidated: false });
      expect(conversation.providerState).toMatchObject({ inlineEditState: { keep: true } });
      expect(readAntigravitySessionState(conversation)?.conversationId).toBe('conv-merge');
    });

    it('passes the configured model and env through the launch spec', async () => {
      const { runtime, fakes } = createHarness({
        providerConfigOverrides: {
          environmentVariables: 'AGY_TEST_FLAG=1',
          manualModelId: 'gemini-3.8-flash-low',
        },
      });
      const conversation = makeConversation('tab-a', undefined, 'antigravity/gemini-3.7-flash-medium');
      syncConversation(runtime, conversation);

      const query = collect(runtime.query(makeTurn('Prompt'), [], { model: 'antigravity/gemini-3.1-pro-high' }));
      await flush();
      fakes[0].playSuccessfulTurn('conv-model', 'Answer');
      await query;

      const spec = fakes[0].spec;
      expect(spec.args[spec.args.indexOf('--model') + 1]).toBe('gemini-3.1-pro-high');
      expect(spec.env.AGY_TEST_FLAG).toBe('1');
      expect(spec.cwd).toBe('D:/vault');
    });
  });

  describe('history replay cache wiring', () => {
    const CONVERSATION_ID = 'e848aee0-1111-2222-3333-444444444444';
    let vaultPath: string;

    beforeEach(() => {
      vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-runtime-replay-'));
    });

    afterEach(() => {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    });

    async function hydrateRestartedConversation(
      conversation: Conversation,
    ): Promise<Conversation> {
      const reopened: Conversation = { ...conversation, messages: [] };
      await new AntigravityConversationHistoryService()
        .hydrateConversationHistory(reopened, vaultPath);
      return reopened;
    }

    function messageSummary(conversation: Conversation): Array<[string, string]> {
      return conversation.messages.map(message => [message.role, message.content]);
    }

    it('records every turn so a restarted runtime and history service replay user, assistant and tool activity in order', async () => {
      const first = createHarness({ useProviderFactory: true, vaultPath });
      syncConversation(first.runtime, makeConversation('tab-a'));

      // Turn 1: no session is bound yet, so the request is recorded when the
      // CLI's own init has bound the conversation id at settle time.
      const firstQuery = collect(first.runtime.query(makeTurn('Fix the bug')));
      await waitForSubprocesses(first.fakes, 1);
      first.fakes[0].playToolTurn(CONVERSATION_ID, 2, 'All done');
      await firstQuery;

      const persisted = makeConversation('tab-a');
      const updates = first.runtime.buildSessionUpdates({ conversation: persisted, sessionInvalidated: false });
      Object.assign(persisted, updates.updates);
      expect(readAntigravitySessionState(persisted)?.conversationId).toBe(CONVERSATION_ID);

      // Turn 2: the session is bound before dispatch, so the request survives
      // even a crash mid-turn.
      const secondQuery = collect(first.runtime.query(makeTurn('Thanks')));
      await waitForSubprocesses(first.fakes, 2);
      first.fakes[1].playSuccessfulTurn(CONVERSATION_ID, 'Anytime.');
      await secondQuery;

      // Restart: a fresh history service reads only the persisted binding.
      const reopened = await hydrateRestartedConversation(persisted);
      expect(messageSummary(reopened)).toEqual([
        ['user', 'Fix the bug'],
        ['assistant', 'All done'],
        ['user', 'Thanks'],
        ['assistant', 'Anytime.'],
      ]);
      expect(reopened.messages[1].toolCalls?.[0]).toMatchObject({
        name: 'run_command',
        result: 'listing',
        status: 'completed',
      });

      // Restart: a fresh runtime resumes the same CLI conversation and keeps
      // appending to the replay cache instead of overwriting its first turn.
      const second = createHarness({ useProviderFactory: true, vaultPath });
      syncConversation(second.runtime, reopened);
      const resumeQuery = collect(second.runtime.query(makeTurn('One more')));
      await waitForSubprocesses(second.fakes, 1);
      second.fakes[0].playSuccessfulTurn(CONVERSATION_ID, 'Sure.');
      await resumeQuery;

      const spec = second.fakes[0].spec;
      expect(spec.args).toContain('--conversation');
      expect(spec.args[spec.args.indexOf('--conversation') + 1]).toBe(CONVERSATION_ID);

      const afterRestart = makeConversation('tab-a');
      const resumeUpdates = second.runtime.buildSessionUpdates({
        conversation: afterRestart,
        sessionInvalidated: false,
      });
      Object.assign(afterRestart, resumeUpdates.updates);
      expect(messageSummary(await hydrateRestartedConversation(afterRestart))).toEqual([
        ['user', 'Fix the bug'],
        ['assistant', 'All done'],
        ['user', 'Thanks'],
        ['assistant', 'Anytime.'],
        ['user', 'One more'],
        ['assistant', 'Sure.'],
      ]);
    });

    it('reports partial history instead of re-sending the conversation when the cache is missing', async () => {
      const harness = createHarness({ useProviderFactory: true, vaultPath });
      const bound = makeConversation('tab-a');
      writeAntigravitySessionState(bound, {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: CONVERSATION_ID,
        turnCount: 3,
      });
      bound.sessionId = CONVERSATION_ID;
      syncConversation(harness.runtime, bound);

      const query = collect(harness.runtime.query(makeTurn('Only this message')));
      await waitForSubprocesses(harness.fakes, 1);
      harness.fakes[0].playSuccessfulTurn(CONVERSATION_ID, 'Answer');
      const chunks = await query;

      expect(chunkTypes(chunks)).toEqual(['notice', 'text', 'usage', 'done']);
      const notice = chunks.find(
        (chunk): chunk is Extract<StreamChunk, { type: 'notice' }> => chunk.type === 'notice',
      );
      expect(notice?.level).toBe('warning');
      expect(notice?.content).toContain('partial');

      // The prompt carries the new message only: earlier messages are never
      // re-encoded as a bulk transcript.
      const spec = harness.fakes[0].spec;
      expect(spec.args[spec.args.indexOf('-p') + 1]).toBe('Only this message');
    });
  });
});
