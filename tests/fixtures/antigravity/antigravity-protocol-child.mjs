// Offline fixture child standing in for the Antigravity CLI (`agy`), used by
// `tests/integration/providers/AntigravityLifecycleFixtures.test.ts` (roadmap A3).
//
// The test harness spawns `node antigravity-protocol-child.mjs <scenario> ...agyArgs`
// where `...agyArgs` is the runtime's real launch-spec argument list passed through
// verbatim. Event shapes mirror the sanitized A0 captures in
// `tests/fixtures/antigravity/jsonl/` (agy 1.1.27 stream-json):
// init → step_update* → exactly one result, exit 0 on success.
//
// Scenarios:
//   print — full successful turn; resumes via `--conversation <id>` (echo behavior
//           verified by A0), otherwise uses AGY_FIXTURE_CONVERSATION_ID or a fresh UUID.
//   hang  — emits init + one agent_response delta, then never produces a result
//           (used for cancel / watchdog kill coverage).
//   fail  — emits init, writes a mock auth error to stderr, exits 3 without a result.
//
// Zero model calls: this is a plain Node script, never the real CLI.

import { randomUUID } from 'node:crypto';

const FORBIDDEN_FLAGS = new Set(['--dangerously-skip-permissions', '-c', '--continue']);

const [, , scenario = 'print', ...agyArgs] = process.argv;

const emit = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

function parseAgyArgs(argv) {
  const parsed = { prompt: '', conversationId: null, model: null, outputFormat: null, printTimeout: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-p') {
      parsed.prompt = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--conversation') {
      parsed.conversationId = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--model') {
      parsed.model = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--output-format') {
      parsed.outputFormat = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--print-timeout') {
      parsed.printTimeout = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return parsed;
}

function buildInitEvent(conversationId, model) {
  return {
    event: 'init',
    conversation_id: conversationId,
    init: {
      model,
      cwd: process.cwd(),
      tools: [],
      permission_mode: 'request-review',
    },
  };
}

function buildStepEvent(conversationId, stepIndex, stepType, state, textDelta) {
  return {
    event: 'step_update',
    step_update: {
      conversation_id: conversationId,
      step_index: stepIndex,
      state,
      step_type: stepType,
      ...(textDelta !== null ? { text_delta: textDelta } : {}),
    },
  };
}

function buildResultEvent(conversationId, response, numTurns) {
  return {
    event: 'result',
    result: {
      conversation_id: conversationId,
      status: 'SUCCESS',
      response,
      duration_seconds: 0.25,
      num_turns: numTurns,
      usage: {
        input_tokens: 120,
        output_tokens: 8,
        thinking_tokens: 0,
        cache_read_tokens: numTurns > 1 ? 512 : 0,
        total_tokens: 128 + (numTurns > 1 ? 512 : 0),
      },
    },
  };
}

const forbidden = agyArgs.find((arg) => FORBIDDEN_FLAGS.has(arg.split('=', 1)[0]));
if (forbidden) {
  process.stderr.write(`antigravity-protocol-child: forbidden flag in argv: ${forbidden}\n`);
  process.exit(42);
}

const args = parseAgyArgs(agyArgs);
const conversationId = args.conversationId
  ?? process.env.AGY_FIXTURE_CONVERSATION_ID
  ?? randomUUID();
const isResume = args.conversationId !== null;

if (scenario === 'fail') {
  emit(buildInitEvent(conversationId, args.model));
  process.stderr.write('mock agy failure: not logged in (fixture)\n');
  process.exitCode = 3;
} else if (scenario === 'hang') {
  emit(buildInitEvent(conversationId, args.model));
  emit(buildStepEvent(conversationId, isResume ? 2 : 0, 'agent_response', 'ACTIVE', 'Hanging partial output '));
  // Never produces a result; the runtime must terminate the process.
  setInterval(() => {}, 60_000);
} else {
  // print scenario: full successful turn.
  const firstDelta = isResume ? 'Resumed ' : 'READY';
  const secondDelta = isResume ? 'reply\n' : '\n';
  emit(buildInitEvent(conversationId, args.model));
  emit(buildStepEvent(conversationId, isResume ? 2 : 0, 'user_input', 'DONE', null));
  emit(buildStepEvent(conversationId, isResume ? 3 : 1, 'agent_response', 'ACTIVE', firstDelta));
  emit(buildStepEvent(conversationId, isResume ? 3 : 1, 'agent_response', 'DONE', secondDelta));
  emit(buildResultEvent(conversationId, `${firstDelta}${secondDelta}`, isResume ? 2 : 1));
  process.exitCode = 0;
}
