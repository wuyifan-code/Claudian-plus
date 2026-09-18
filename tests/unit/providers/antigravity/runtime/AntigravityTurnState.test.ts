import { AntigravityTurnState } from '@/providers/antigravity/runtime/AntigravityTurnState';

import { readAntigravityEventFixture } from '../helpers/antigravityEventFixtures';

const TURN1_SESSION = 'e848aee0-50a4-4889-9b1b-697878871fa2';

function runFixture(turn: AntigravityTurnState, name: string) {
  return readAntigravityEventFixture(name).map((event) => turn.ingest(event));
}

describe('AntigravityTurnState — successful settlement', () => {
  it('settles a successful turn exactly once and suppresses duplicate terminal events', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: '00000000-0000-4000-8000-0000000000a5' });

    const results = runFixture(turn, 'duplicate-terminal.ndjson');
    const settlements = results
      .map((result) => result.settlement)
      .filter((settlement) => settlement !== null);
    expect(settlements).toEqual([
      { phase: 'completed', source: 'result', reason: 'success' },
    ]);
    expect(turn.phase).toBe('completed');

    const duplicateEvent = readAntigravityEventFixture('duplicate-terminal.ndjson')[5];
    const duplicate = turn.ingest(duplicateEvent);
    expect(duplicate).toEqual({ chunks: [], suppressed: true, settlement: null });
    expect(turn.assistantText).toBe('READY\n');
    expect(turn.boundSessionId).toBe('00000000-0000-4000-8000-0000000000a5');
  });

  it('binds init metadata without emitting an assistant message and confirms the session', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: TURN1_SESSION });

    const result = turn.ingest(readAntigravityEventFixture('turn1-ready.ndjson')[0]);
    expect(result.chunks).toEqual([]);
    expect(result.suppressed).toBe(false);
    expect(result.settlement).toBeNull();
    expect(turn.phase).toBe('running');
    expect(turn.boundSessionId).toBe(TURN1_SESSION);
    expect(turn.assistantText).toBe('');
  });

  it('suppresses events that arrive before beginTurn', () => {
    const turn = new AntigravityTurnState(0);
    expect(turn.ingest({ event: 'init' })).toEqual({ chunks: [], suppressed: true, settlement: null });
    expect(turn.phase).toBe('idle');
  });
});

describe('AntigravityTurnState — cancel racing a result', () => {
  it('lets a late result complete the turn after a cancel request, exactly once', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn();
    const events = readAntigravityEventFixture('cancel-race.ndjson');

    for (const event of events.slice(0, -1)) {
      turn.ingest(event);
    }
    expect(turn.requestCancel()).toBe(true);
    expect(turn.phase).toBe('cancelling');

    const result = turn.ingest(events[events.length - 1]);
    expect(result.settlement).toEqual({ phase: 'completed', source: 'result', reason: 'success' });
    expect(turn.requestCancel()).toBe(false);
    expect(turn.phase).toBe('completed');
    expect(turn.assistantText).toBe('Partial text');
  });

  it('ignores a cancel request that arrives after the turn settled', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn();
    for (const event of readAntigravityEventFixture('cancel-race.ndjson')) {
      turn.ingest(event);
    }
    expect(turn.phase).toBe('completed');
    expect(turn.requestCancel()).toBe(false);
    expect(turn.phase).toBe('completed');
  });

  it('settles a cancelled process exactly once once the stream ends', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn();
    const events = readAntigravityEventFixture('timeout.ndjson');
    for (const event of events) {
      turn.ingest(event);
    }

    turn.requestCancel();
    turn.markProcessExit({ exitCode: 1, timedOut: false, killed: true });
    expect(turn.settlement).toBeNull();

    expect(turn.markStreamEnd()).toEqual({ phase: 'failed', source: 'stream-end', reason: 'cancelled' });
    expect(turn.markStreamEnd()).toBeNull();
    expect(turn.phase).toBe('failed');
  });
});

describe('AntigravityTurnState — tool behavior', () => {
  it('surfaces a failed tool as an error result and still completes the turn', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: '00000000-0000-4000-8000-0000000000a3' });

    const results = runFixture(turn, 'tool-failure.ndjson');
    const toolResult = results
      .flatMap((result) => result.chunks)
      .find((chunk) => chunk.type === 'tool_result');
    expect(toolResult).toMatchObject({
      id: 'agy:00000000-0000-4000-8000-0000000000a3:turn0:step1',
      content: 'Command exited with code 1',
      isError: true,
    });
    expect(turn.settlement).toEqual({ phase: 'completed', source: 'result', reason: 'success' });
  });

  it('completes a permission denial with exit code 0 instead of treating it as incomplete', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: '00000000-0000-4000-8000-0000000000a4' });

    const results = runFixture(turn, 'permission-denied-exit0.ndjson');
    const toolResult = results
      .flatMap((result) => result.chunks)
      .find((chunk) => chunk.type === 'tool_result');
    expect(toolResult).toMatchObject({ isError: true, content: 'Permission denied for run_command by the request-review policy' });
    expect(turn.settlement).toEqual({ phase: 'completed', source: 'result', reason: 'success' });

    turn.markProcessExit({ exitCode: 0, timedOut: false, killed: false });
    expect(turn.markStreamEnd()).toBeNull();
    expect(turn.phase).toBe('completed');
  });

  it('keeps tool keys distinct per turn index across turns of one session', () => {
    const first = new AntigravityTurnState(0);
    first.beginTurn();
    const firstChunks = readAntigravityEventFixture('multi-step-tools.ndjson').flatMap((event) =>
      first.ingest(event).chunks,
    );
    const second = new AntigravityTurnState(1);
    second.beginTurn();
    const secondChunks = readAntigravityEventFixture('multi-step-tools.ndjson').flatMap((event) =>
      second.ingest(event).chunks,
    );

    const firstToolUse = firstChunks.find((chunk) => chunk.type === 'tool_use');
    const secondToolUse = secondChunks.find((chunk) => chunk.type === 'tool_use');
    expect(firstToolUse).toMatchObject({ id: 'agy:00000000-0000-4000-8000-0000000000a2:turn0:step2' });
    expect(secondToolUse).toMatchObject({ id: 'agy:00000000-0000-4000-8000-0000000000a2:turn1:step2' });
  });
});

describe('AntigravityTurnState — process signals and failure settlement', () => {
  it('treats exit code 0 without a result as an incomplete result, not a success', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: '00000000-0000-4000-8000-000000000000' });

    const results = runFixture(turn, 'eof-before-completion.ndjson');
    expect(results).toHaveLength(1);
    expect(results[0].settlement).toBeNull();
    expect(turn.assistantText).toBe('');

    turn.markProcessExit({ exitCode: 0, timedOut: false, killed: false });
    expect(turn.settlement).toBeNull();
    expect(turn.markStreamEnd()).toEqual({
      phase: 'failed',
      source: 'stream-end',
      reason: 'incomplete-result',
    });
    expect(turn.phase).toBe('failed');
  });

  it('still settles a drained result that arrives after the process exited', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn();
    const events = readAntigravityEventFixture('turn1-ready.ndjson');

    for (const event of events.slice(0, -1)) {
      turn.ingest(event);
    }
    turn.markProcessExit({ exitCode: 0, timedOut: false, killed: false });
    expect(turn.settlement).toBeNull();

    const drained = turn.ingest(events[events.length - 1]);
    expect(drained.settlement).toEqual({ phase: 'completed', source: 'result', reason: 'success' });
    expect(turn.markStreamEnd()).toBeNull();
  });

  it('settles a timeout exactly once regardless of signal order', () => {
    const timedOutFirst = new AntigravityTurnState(0);
    timedOutFirst.beginTurn();
    for (const event of readAntigravityEventFixture('timeout.ndjson')) {
      timedOutFirst.ingest(event);
    }
    timedOutFirst.markTimedOut();
    timedOutFirst.markProcessExit({ exitCode: null, timedOut: true, killed: true });
    expect(timedOutFirst.markStreamEnd()).toEqual({
      phase: 'failed',
      source: 'stream-end',
      reason: 'timeout',
    });

    const exitedFirst = new AntigravityTurnState(0);
    exitedFirst.beginTurn();
    for (const event of readAntigravityEventFixture('timeout.ndjson')) {
      exitedFirst.ingest(event);
    }
    exitedFirst.markProcessExit({ exitCode: null, timedOut: true, killed: true });
    expect(exitedFirst.markStreamEnd()).toEqual({
      phase: 'failed',
      source: 'stream-end',
      reason: 'timeout',
    });
  });

  it('settles a non-zero exit without a result as an exit failure', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn();
    turn.ingest(readAntigravityEventFixture('eof-before-completion.ndjson')[0]);
    turn.markProcessExit({ exitCode: 1, timedOut: false, killed: false });
    expect(turn.markStreamEnd()).toEqual({
      phase: 'failed',
      source: 'stream-end',
      reason: 'exit-failure',
      detail: 'exit code 1',
    });
  });

  it('settles a spawn failure once and refuses further events', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn();
    expect(turn.markProcessSpawnError('spawn ENOENT')).toEqual({
      phase: 'failed',
      source: 'spawn-error',
      reason: 'spawn-failed',
      detail: 'spawn ENOENT',
    });
    expect(turn.ingest({ event: 'init' }).suppressed).toBe(true);
    expect(turn.markStreamEnd()).toBeNull();
  });

  it('does not treat an unknown result status as success', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: '00000000-0000-4000-8000-0000000000a6' });

    const results = runFixture(turn, 'unknown-status.ndjson');
    const lastResult = results[results.length - 1];
    expect(lastResult.settlement).toEqual({
      phase: 'failed',
      source: 'result',
      reason: 'unknown-status',
      detail: 'status PARKED',
    });
    expect(lastResult.chunks.filter((chunk) => chunk.type === 'error')).toEqual([
      { type: 'error', content: 'Antigravity result reported unknown status "PARKED".' },
    ]);
    expect(lastResult.chunks.filter((chunk) => chunk.type === 'usage')).toHaveLength(1);
    expect(turn.phase).toBe('failed');
  });

  it('settles a malformed result event as failed instead of success', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: '00000000-0000-4000-8000-0000000000b1' });

    const results = runFixture(turn, 'malformed-result.ndjson');
    const lastResult = results[results.length - 1];
    expect(lastResult.settlement).toEqual({
      phase: 'failed',
      source: 'result',
      reason: 'malformed-result',
    });
    expect(lastResult.chunks).toEqual([
      { type: 'error', content: 'Antigravity sent a malformed result event.' },
    ]);
  });

  it('continues after malformed step events and settles from the final result', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: '00000000-0000-4000-8000-0000000000b2' });

    const results = runFixture(turn, 'malformed-step.ndjson');
    expect(turn.settlement).toEqual({ phase: 'completed', source: 'result', reason: 'success' });
    expect(results[1].chunks).toEqual([
      { type: 'notice', content: 'Antigravity sent a malformed step_update event.', level: 'warning' },
    ]);
    expect(results[2].chunks).toEqual([
      { type: 'notice', content: 'Antigravity sent a malformed step_update event.', level: 'warning' },
    ]);
    expect(turn.assistantText).toBe('Recovered.\n');
  });

  it('fails the turn when init binds a different session than expected', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: 'expected-session' });

    const result = turn.ingest({
      event: 'init',
      conversation_id: 'foreign-session',
      init: { model: 'gemini-3.8-flash-low', cwd: '<TMP>', tools: [], permission_mode: 'request-review' },
    });
    expect(result.settlement).toEqual({
      phase: 'failed',
      source: 'guard',
      reason: 'session-mismatch',
    });
    expect(turn.sessionMismatchCount).toBe(1);
    expect(turn.ingest({ event: 'step_update', step_update: {} }).suppressed).toBe(true);
  });

  it('ignores step and result events bound to a foreign conversation', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: 'e848aee0-50a4-4889-9b1b-697878871fa2' });
    const events = readAntigravityEventFixture('turn1-ready.ndjson');
    turn.ingest(events[0]);

    const foreignStep = turn.ingest({
      event: 'step_update',
      step_update: {
        conversation_id: 'some-other-conversation',
        step_index: 0,
        state: 'ACTIVE',
        step_type: 'agent_response',
        text_delta: 'FOREIGN',
      },
    });
    expect(foreignStep.suppressed).toBe(true);
    expect(foreignStep.chunks).toEqual([]);
    expect(turn.sessionMismatchCount).toBe(1);
    expect(turn.assistantText).toBe('');

    const foreignResult = turn.ingest({
      event: 'result',
      result: { conversation_id: 'some-other-conversation', status: 'SUCCESS', response: 'FOREIGN' },
    });
    expect(foreignResult.settlement).toEqual({
      phase: 'failed',
      source: 'guard',
      reason: 'session-mismatch',
    });
    expect(turn.assistantText).toBe('');
  });
});

describe('AntigravityTurnState — usage and diagnostics', () => {
  it('emits usage exactly once per turn from the result, not from steps', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: '00000000-0000-4000-8000-0000000000a2' });

    const chunks = runFixture(turn, 'multi-step-tools.ndjson').flatMap((result) => result.chunks);
    const usageChunks = chunks.filter((chunk) => chunk.type === 'usage');
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0]).toMatchObject({
      type: 'usage',
      usage: {
        inputTokens: 1500,
        cacheReadInputTokens: 0,
        contextTokens: 1500,
        contextWindow: 0,
        contextWindowIsAuthoritative: false,
        percentage: 0,
        model: 'gemini-3.8-flash-low',
      },
      sessionId: '00000000-0000-4000-8000-0000000000a2',
    });
  });

  it('counts unknown events with bounded diagnostics without failing the turn', () => {
    const turn = new AntigravityTurnState(0);
    turn.beginTurn({ expectedSessionId: '00000000-0000-4000-8000-0000000000b5' });

    const results = runFixture(turn, 'unknown-event.ndjson');
    expect(turn.unknownEventCount).toBe(1);
    expect(turn.settlement).toEqual({ phase: 'completed', source: 'result', reason: 'success' });
    expect(turn.assistantText).toBe('Hello');
    expect(results[2].chunks).toEqual([]);
  });
});

describe('AntigravityTurnState — consecutive turns', () => {
  it('keeps text of two consecutive turns separate and refuses reuse of a settled state', () => {
    const first = new AntigravityTurnState(0);
    first.beginTurn({ expectedSessionId: TURN1_SESSION });
    for (const event of readAntigravityEventFixture('turn1-ready.ndjson')) {
      first.ingest(event);
    }
    expect(first.assistantText).toBe('READY\n');
    expect(first.phase).toBe('completed');

    const lateDelta = first.ingest({
      event: 'step_update',
      step_update: {
        conversation_id: TURN1_SESSION,
        step_index: 9,
        state: 'ACTIVE',
        step_type: 'agent_response',
        text_delta: 'LATE',
      },
    });
    expect(lateDelta).toEqual({ chunks: [], suppressed: true, settlement: null });
    expect(first.assistantText).toBe('READY\n');
    expect(() => first.beginTurn()).toThrow();

    const second = new AntigravityTurnState(1);
    second.beginTurn({ expectedSessionId: TURN1_SESSION });
    for (const event of readAntigravityEventFixture('turn2-resume.ndjson')) {
      second.ingest(event);
    }
    expect(second.assistantText).toBe('OK-2\n');
    expect(second.boundSessionId).toBe(TURN1_SESSION);
    expect(second.turnIndex).toBe(1);
    expect(first.assistantText).toBe('READY\n');
  });
});

describe('AntigravityTurnState — process phase tracking', () => {
  it('keeps the process phase separate from the turn phase', () => {
    const turn = new AntigravityTurnState(0);
    expect(turn.processPhase).toBe('idle');

    turn.markProcessSpawning();
    expect(turn.processPhase).toBe('spawning');
    turn.markProcessActive();
    expect(turn.processPhase).toBe('active');

    turn.beginTurn();
    turn.ingest(readAntigravityEventFixture('turn1-ready.ndjson')[0]);
    expect(turn.phase).toBe('running');
    expect(turn.processPhase).toBe('active');

    turn.markProcessExit({ exitCode: 0, timedOut: false, killed: false });
    expect(turn.processPhase).toBe('exited');
    expect(turn.phase).toBe('running');
    turn.markStreamEnd();
    expect(turn.settlement).toEqual({ phase: 'failed', source: 'stream-end', reason: 'incomplete-result' });
  });
});
