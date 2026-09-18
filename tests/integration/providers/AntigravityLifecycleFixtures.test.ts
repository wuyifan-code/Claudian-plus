import * as path from 'node:path';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { Conversation, StreamChunk } from '@/core/types';
import { AntigravityChatRuntime } from '@/providers/antigravity/runtime/AntigravityChatRuntime';
import type { AntigravitySubprocessLaunchSpec } from '@/providers/antigravity/runtime/AntigravitySubprocess';
import { AntigravitySubprocess } from '@/providers/antigravity/runtime/AntigravitySubprocess';
import {
  ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
  readAntigravitySessionState,
} from '@/providers/antigravity/types';

const FIXTURE_CHILD_PATH = path.join(process.cwd(), 'tests', 'fixtures', 'antigravity', 'antigravity-protocol-child.mjs');

interface FixtureHarness {
  runtime: AntigravityChatRuntime;
  specs: AntigravitySubprocessLaunchSpec[];
  subprocesses: AntigravitySubprocess[];
  setScenario(scenario: 'print' | 'hang' | 'fail'): void;
}

function createPlugin(providerConfigOverrides: Record<string, unknown> = {}): ProviderHost {
  const settings: Record<string, unknown> = {
    providerConfigs: {
      antigravity: {
        enabled: true,
        cliPath: 'agy-resolved-by-fixture-harness',
        timeoutMs: 20_000,
        environmentVariables: '',
        manualModelId: '',
        ...providerConfigOverrides,
      },
    },
  };
  return {
    app: { vault: { adapter: { basePath: process.cwd() } } },
    settings,
    storage: {},
    saveSettings: async () => {},
    mutateSettings: () => {},
    mutateSettingsConditionally: () => {},
    loadData: async () => null,
    saveData: async () => {},
    normalizeModelVariantSettings: () => false,
    getActiveEnvironmentVariables: () => '',
    getEnvironmentVariablesForScope: () => '',
    applyEnvironmentVariables: async () => {},
    applyEnvironmentVariablesBatch: async () => {},
    getResolvedProviderCliPath: async () => 'agy-resolved-by-fixture-harness',
    getMemoryInjectionText: async () => null,
    getConsciousnessInjectionText: async () => null,
  } as unknown as ProviderHost;
}

/**
 * Builds a runtime wired to the real `AntigravitySubprocess` (real spawn, real
 * SubprocessRunner process management, real JSONL drain) whose command is the
 * fixture child instead of the real `agy` binary. No live model calls happen.
 */
function createHarness(providerConfigOverrides: Record<string, unknown> = {}): FixtureHarness {
  let scenario: 'print' | 'hang' | 'fail' = 'print';
  const specs: AntigravitySubprocessLaunchSpec[] = [];
  const subprocesses: AntigravitySubprocess[] = [];
  const runtime = new AntigravityChatRuntime(createPlugin(providerConfigOverrides), {
    resolveCliPath: async () => 'agy-resolved-by-fixture-harness',
    createSubprocess: (spec) => {
      specs.push(spec);
      const subprocess = new AntigravitySubprocess({
        ...spec,
        command: process.execPath,
        args: [FIXTURE_CHILD_PATH, scenario, ...spec.args],
      });
      subprocesses.push(subprocess);
      return subprocess;
    },
  });
  return {
    runtime,
    specs,
    subprocesses,
    setScenario(next) {
      scenario = next;
    },
  };
}

function makeConversation(id: string, providerState?: Record<string, unknown>): Conversation {
  return {
    id,
    providerId: 'antigravity',
    title: `Conversation ${id}`,
    createdAt: 0,
    updatedAt: 0,
    sessionId: null,
    messages: [],
    ...(providerState ? { providerState } : {}),
  };
}

function syncConversation(runtime: AntigravityChatRuntime, conversation: Conversation | null): void {
  runtime.syncConversationState(
    conversation
      ? {
        id: conversation.id,
        sessionId: conversation.sessionId,
        providerState: conversation.providerState,
        selectedModel: conversation.selectedModel,
      }
      : null,
  );
}

async function collect(generator: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }
  return chunks;
}

function textOf(chunks: StreamChunk[]): string {
  return chunks
    .filter((chunk): chunk is Extract<StreamChunk, { type: 'text' }> => chunk.type === 'text')
    .map((chunk) => chunk.content)
    .join('');
}

async function waitFor(condition: () => boolean, description: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`fixture condition not met within ${timeoutMs} ms: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function withCleanup(harness: FixtureHarness, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } finally {
    harness.runtime.cleanup();
    for (const subprocess of harness.subprocesses) {
      if (subprocess.isAlive()) {
        await subprocess.shutdown();
      }
    }
  }
}

describe('Antigravity lifecycle fixtures (real subprocess, fixture agy protocol)', () => {
  it(
    'runs a full print turn through the real process, JSONL drain, and turn state',
    async () => {
      const harness = createHarness({ environmentVariables: 'AGY_FIXTURE_CONVERSATION_ID=conv-fresh-fixture' });
      const conversation = makeConversation('tab-fixture-a');
      syncConversation(harness.runtime, conversation);

      await withCleanup(harness, async () => {
        const turn = harness.runtime.prepareTurn({ text: 'Reply with exactly READY. Do not use tools.' });
        const chunks = await collect(harness.runtime.query(turn));

        expect(textOf(chunks)).toBe('READY\n');
        expect(chunks[chunks.length - 1].type).toBe('done');
        expect(chunks.some((chunk) => chunk.type === 'usage')).toBe(true);

        // The launch arguments are the verified print-mode shape, built by the
        // launch spec (never a shell string), without forbidden flags.
        const spec = harness.specs[0];
        expect(spec.args.slice(0, 4)).toEqual([
          '-p',
          'Reply with exactly READY. Do not use tools.',
          '--output-format',
          'stream-json',
        ]);
        expect(spec.args).toContain('--print-timeout');
        expect(spec.args.join(' ')).not.toContain('--dangerously-skip-permissions');
        expect(spec.args).not.toContain('--conversation');

        const updates = harness.runtime.buildSessionUpdates({ conversation, sessionInvalidated: false });
        expect(readAntigravitySessionState(conversation)).toEqual({
          schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
          conversationId: 'conv-fresh-fixture',
          turnCount: 1,
        });
        expect(updates.updates.sessionId).toBe('conv-fresh-fixture');
      });
    },
    20_000,
  );

  it(
    'resumes the next turn with the verified explicit --conversation id',
    async () => {
      const harness = createHarness({ environmentVariables: 'AGY_FIXTURE_CONVERSATION_ID=conv-resume-fixture' });
      syncConversation(harness.runtime, makeConversation('tab-fixture-a'));

      await withCleanup(harness, async () => {
        const firstChunks = await collect(harness.runtime.query(harness.runtime.prepareTurn({ text: 'First turn' })));
        expect(textOf(firstChunks)).toBe('READY\n');

        const secondChunks = await collect(harness.runtime.query(harness.runtime.prepareTurn({ text: 'Second turn' })));
        expect(textOf(secondChunks)).toBe('Resumed reply\n');

        const resumeSpec = harness.specs[1];
        expect(resumeSpec.args).toContain('--conversation');
        expect(resumeSpec.args[resumeSpec.args.indexOf('--conversation') + 1]).toBe('conv-resume-fixture');

        const conversation = makeConversation('tab-fixture-a');
        harness.runtime.buildSessionUpdates({ conversation, sessionInvalidated: false });
        expect(readAntigravitySessionState(conversation)?.turnCount).toBe(2);
      });
    },
    20_000,
  );

  it(
    'cancel terminates the real process without orphans and the next turn resumes the conversation',
    async () => {
      const harness = createHarness({ environmentVariables: 'AGY_FIXTURE_CONVERSATION_ID=conv-cancel-fixture' });
      syncConversation(harness.runtime, makeConversation('tab-fixture-a'));

      await withCleanup(harness, async () => {
        harness.setScenario('hang');
        const generator = harness.runtime.query(harness.runtime.prepareTurn({ text: 'Long running turn' }));
        const iterator = generator[Symbol.asyncIterator]();

        // Wait until the hung child's partial output has streamed through.
        const first = await iterator.next();
        expect(first.value.type).toBe('text');
        expect((first.value as Extract<StreamChunk, { type: 'text' }>).content).toContain('Hanging partial output');

        harness.runtime.cancel();
        const remaining: StreamChunk[] = [first.value];
        for await (const chunk of generator) {
          remaining.push(chunk);
        }
        expect(remaining.map((chunk) => chunk.type)).toEqual(['text', 'notice', 'done']);

        // The killed process must actually be gone (no orphan agy/node child).
        await waitFor(() => !harness.subprocesses[0].isAlive(), 'cancelled process to exit');
        expect(harness.subprocesses[0].getStderrSnapshot()).toBeDefined();

        // The turn recorded the real conversation id from the child's init,
        // so the next turn resumes it explicitly.
        harness.setScenario('print');
        const resumedChunks = await collect(harness.runtime.query(harness.runtime.prepareTurn({ text: 'After cancel' })));
        expect(textOf(resumedChunks)).toBe('Resumed reply\n');
        const resumeSpec = harness.specs[1];
        expect(resumeSpec.args).toContain('--conversation');
        expect(resumeSpec.args[resumeSpec.args.indexOf('--conversation') + 1]).toBe('conv-cancel-fixture');
      });
    },
    30_000,
  );

  it(
    'surfaces a real non-zero exit without a result as a failed turn',
    async () => {
      const harness = createHarness({ environmentVariables: 'AGY_FIXTURE_CONVERSATION_ID=conv-fail-fixture' });
      syncConversation(harness.runtime, makeConversation('tab-fixture-a'));

      await withCleanup(harness, async () => {
        harness.setScenario('fail');
        const chunks = await collect(harness.runtime.query(harness.runtime.prepareTurn({ text: 'Failing turn' })));

        expect(chunks[chunks.length - 1].type).toBe('done');
        const errorChunk = chunks.find((chunk) => chunk.type === 'error');
        expect(errorChunk).toBeDefined();
        expect(harness.runtime.isReady()).toBe(false);

        const conversation = makeConversation('tab-fixture-a');
        harness.runtime.buildSessionUpdates({ conversation, sessionInvalidated: false });
        // The child's own init bound a real conversation id, so the runtime
        // records it for resume (turn count stays at zero — the turn failed);
        // a turn with no init at all would record nothing.
        expect(readAntigravitySessionState(conversation)).toEqual({
          schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
          conversationId: 'conv-fail-fixture',
          turnCount: 0,
        });
      });
    },
    20_000,
  );

  it(
    'keeps two real child processes and their session bindings isolated',
    async () => {
      const harnessA = createHarness({ environmentVariables: 'AGY_FIXTURE_CONVERSATION_ID=conv-iso-a' });
      const harnessB = createHarness({ environmentVariables: 'AGY_FIXTURE_CONVERSATION_ID=conv-iso-b' });
      syncConversation(harnessA.runtime, makeConversation('tab-iso-a'));
      syncConversation(harnessB.runtime, makeConversation('tab-iso-b'));

      try {
        const queryA = collect(harnessA.runtime.query(harnessA.runtime.prepareTurn({ text: 'Tab A prompt' })));
        const queryB = collect(harnessB.runtime.query(harnessB.runtime.prepareTurn({ text: 'Tab B prompt' })));
        const [chunksA, chunksB] = await Promise.all([queryA, queryB]);

        expect(textOf(chunksA)).toBe('READY\n');
        expect(textOf(chunksB)).toBe('READY\n');
        expect(harnessA.specs[0].cwd).toBe(process.cwd());

        const conversationA = makeConversation('tab-iso-a');
        const conversationB = makeConversation('tab-iso-b');
        harnessA.runtime.buildSessionUpdates({ conversation: conversationA, sessionInvalidated: false });
        harnessB.runtime.buildSessionUpdates({ conversation: conversationB, sessionInvalidated: false });
        expect(readAntigravitySessionState(conversationA)?.conversationId).toBe('conv-iso-a');
        expect(readAntigravitySessionState(conversationB)?.conversationId).toBe('conv-iso-b');
      } finally {
        harnessA.runtime.cleanup();
        harnessB.runtime.cleanup();
        for (const harness of [harnessA, harnessB]) {
          for (const subprocess of harness.subprocesses) {
            if (subprocess.isAlive()) {
              await subprocess.shutdown();
            }
          }
        }
      }
    },
    30_000,
  );
});
