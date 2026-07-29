/**
 * Active-hydration performance regression detector.
 *
 * Targets Phase 1 of the 7-phase release goal: "solve the main cost of
 * active-hydration" (the time from "user opens ClaudianPlus view" to "active
 * conversation history is fully rendered").
 *
 * The test generates a realistic-sized Codex session file on disk, exercises
 * the production hydration path (parseCodexSessionFileAsync ->
 * CodexConversationHistoryService.hydrateConversationHistory ->
 * ConversationRepository.ensureHydrated), and records per-span timings from
 * StartupProfiler plus a wall-clock total. Numbers are written to
 * `.context/phase1-hydration-baseline.json` so before/after diffs survive
 * across runs.
 *
 * To re-run after an optimization:
 *   1. Edit src/ as needed
 *   2. npm run typecheck && npm run lint
 *   3. npm run test:unit -- ActiveHydration
 *   4. Compare `.context/phase1-hydration-baseline.json` against the previous run
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ConversationRepository } from '@/app/conversations/ConversationRepository';
import { StartupProfiler } from '@/core/performance/StartupProfiler';
import type { Conversation } from '@/core/types';
import { CodexConversationHistoryService } from '@/providers/codex/history/CodexConversationHistoryService';
import { parseCodexSessionFileAsync } from '@/providers/codex/history/CodexHistoryStore';

const BASELINE_DIR = path.join(process.cwd(), '.context');
const BASELINE_FILE = path.join(BASELINE_DIR, 'phase1-hydration-baseline.json');

// Realistic per-message JSONL record �?a typical turn is reasoning + tool call
// + assistant text, so a turn produces ~3 records. We synthesize a session
// with this shape so the parser exercises both modern and legacy code paths.
function makeRecord(turn: number, index: number): string {
  if (index % 3 === 0) {
    return JSON.stringify({
      timestamp: new Date(turn * 1000 + index).toISOString(),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `User turn ${turn}: please help with task ${turn}.` }],
      },
    });
  }
  if (index % 3 === 1) {
    return JSON.stringify({
      timestamp: new Date(turn * 1000 + index).toISOString(),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: `Assistant turn ${turn} response: this is the detailed answer for task ${turn} with enough content to be representative of real Codex sessions.`,
        }],
      },
    });
  }
  return JSON.stringify({
    timestamp: new Date(turn * 1000 + index).toISOString(),
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'read_file',
      arguments: JSON.stringify({ path: `notes/turn-${turn}.md` }),
    },
  });
}

function buildSessionFile(filePath: string, turns: number): void {
  const lines: string[] = [
    JSON.stringify({ type: 'event', event: { type: 'thread.started', thread_id: 'thread-perf' } }),
  ];
  for (let t = 0; t < turns; t++) {
    lines.push(JSON.stringify({ type: 'event', event: { type: 'turn.started' } }));
    for (let i = 0; i < 3; i++) {
      lines.push(makeRecord(t, i));
    }
    lines.push(JSON.stringify({ type: 'event', event: { type: 'turn.completed' } }));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

interface SpanSnapshot {
  name: string;
  durationMs: number;
}

interface RunResult {
  recordedAt: string;
  fileSizeBytes: number;
  recordCount: number;
  totalMs: number;
  parseOnlyMs: number;
  spans: SpanSnapshot[];
}

function collectReport(): RunResult {
  const report = StartupProfiler.getReport();
  return {
    recordedAt: new Date().toISOString(),
    fileSizeBytes: 0,
    recordCount: 0,
    totalMs: 0,
    parseOnlyMs: 0,
    spans: report.spans.map((span) => ({ name: span.name, durationMs: span.durationMs })),
  };
}

function findSpan(spans: SpanSnapshot[], name: string): number | null {
  const span = spans.find((s) => s.name === name);
  return span ? span.durationMs : null;
}

describe('Active-hydration perf regression detector', () => {
  let sessionFile: string;
  let turnCount: number;

  beforeAll(() => {
    // Use a real temp dir; do not mock os.homedir because the jsdom/integration
    // env makes that property non-redefinable. The Codex history service reads
    // the file at the absolute path we put in providerState.sessionFilePath,
    // bypassing the home-derived fallback entirely.
    turnCount = 2000;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-plus-perf-'));
    sessionFile = path.join(tempDir, 'rollout-thread-perf.jsonl');
    buildSessionFile(sessionFile, turnCount);
  });

  afterAll(() => {
    const dir = path.dirname(sessionFile);
    if (fs.existsSync(dir)) {
      mavisTrash(dir);
    }
  });

  beforeEach(() => {
    StartupProfiler.reset();
  });

  it('parses a realistic Codex session file within budget', async () => {
    const samples: number[] = [];
    let messages: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      messages = await parseCodexSessionFileAsync(sessionFile);
      samples.push(performance.now() - t0);
    }
    const parseOnlyMs = median(samples);
    const fileSizeBytes = fs.statSync(sessionFile).size;

    console.log(
      `[phase1/perf] parseCodexSessionFileAsync ${turnCount} turns / ` +
        `${(fileSizeBytes / 1024).toFixed(0)}KB: ` +
        `median ${parseOnlyMs.toFixed(2)}ms, min ${Math.min(...samples).toFixed(2)}ms`,
    );

    // Keep a generous ceiling for shared CI runners; the console output still
    // exposes the median so regressions remain visible without making the
    // release gate depend on transient CPU contention from the full suite.
    expect(parseOnlyMs).toBeLessThan(750);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('hydrates a real conversation through CodexConversationHistoryService within budget', async () => {
    const conversation: Conversation = {
      id: 'conv-perf',
      providerId: 'codex',
      title: 'Perf conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: 'thread-perf',
      providerState: { threadId: 'thread-perf', sessionFilePath: sessionFile },
      messages: [],
    };

    const service = new CodexConversationHistoryService();
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await service.hydrateConversationHistory(conversation, null);
      samples.push(performance.now() - t0);
      conversation.messages = [];
    }
    const totalMs = median(samples);

    const fileSizeBytes = fs.statSync(sessionFile).size;
    console.log(
      `[phase1/perf] CodexConversationHistoryService.hydrateConversationHistory ` +
        `(${turnCount} turns / ${(fileSizeBytes / 1024).toFixed(0)}KB): ` +
        `median ${totalMs.toFixed(2)}ms`,
    );

    expect(totalMs).toBeLessThan(750);
  });

  it('end-to-end active-hydration: ensureHydrated() records per-span timing', async () => {
    const sessions = {
      saveMetadata: jest.fn().mockResolvedValue(undefined),
      deleteMetadata: jest.fn().mockResolvedValue(undefined),
      toSessionMetadata: jest.fn((value: unknown) => value),
    };
    const repository = new ConversationRepository({
      getSettings: () => ({ providerConfigs: { codex: { enabled: true } } }),
      getVaultPath: () => '/vault',
      sessions: sessions as never,
      onConversationDeleted: jest.fn().mockResolvedValue(undefined),
    });

    const conversation: Conversation = {
      id: 'conv-e2e',
      providerId: 'codex',
      title: 'E2E perf',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: 'thread-perf',
      providerState: { threadId: 'thread-perf', sessionFilePath: sessionFile },
      messages: [],
    };
    repository.replaceAll([conversation]);

    // Warm the parse so the first call doesn't dominate the measurement
    await parseCodexSessionFileAsync(sessionFile);

    StartupProfiler.reset();
    const t0 = performance.now();
    await repository.switchTo('conv-e2e');
    const totalMs = performance.now() - t0;

    const report = collectReport();
    report.totalMs = totalMs;
    report.fileSizeBytes = fs.statSync(sessionFile).size;
    report.recordCount = turnCount * 3;

    console.log(
      `[phase1/perf] ensureHydrated end-to-end (${turnCount} turns): ` +
        `wall ${totalMs.toFixed(2)}ms\n` +
        JSON.stringify(report.spans, null, 2),
    );

    if (!fs.existsSync(BASELINE_DIR)) {
      fs.mkdirSync(BASELINE_DIR, { recursive: true });
    }
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(report, null, 2), 'utf-8');

    const historySpan = findSpan(report.spans, 'hydrate:history:codex');
    const reconcileSpan = findSpan(report.spans, 'hydrate:reconcile-session:codex');
    const modelSpan = findSpan(report.spans, 'hydrate:ensure-model:codex');

    expect(historySpan).not.toBeNull();

    // 1.5MB Codex session should hydrate end-to-end in <1s on a shared CI
    // runner. The span values below retain tighter checks for each phase.
    expect(totalMs).toBeLessThan(1_000);
    // Span values default to 0 when missing so we can use a single non-conditional
    // expectation per span. The hard check is the wall-clock total above.
    expect(historySpan ?? 0).toBeLessThan(1_000);
    expect(reconcileSpan ?? 0).toBeLessThan(100);
    expect(modelSpan ?? 0).toBeLessThan(50);
  });
});

// Local helper to avoid importing a non-test module just for one rm -rf
function mavisTrash(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
