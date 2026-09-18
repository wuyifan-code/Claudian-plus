import {
  classifyAntigravityEvent,
  createAntigravityEventNormalizationState,
  getAntigravityAccumulatedText,
  normalizeAntigravityEvent,
  readAntigravityInit,
  readAntigravityResult,
  readAntigravityStepUpdate,
} from '@/providers/antigravity/normalizations/antigravityEventNormalization';

import { readAntigravityEventFixture } from '../helpers/antigravityEventFixtures';

const TURN1_SESSION = 'e848aee0-50a4-4889-9b1b-697878871fa2';

function usageChunk(overrides: {
  contextTokens: number;
  inputTokens: number;
  cacheReadInputTokens?: number;
  sessionId: string;
}) {
  return {
    type: 'usage',
    usage: {
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: overrides.cacheReadInputTokens ?? 0,
      contextTokens: overrides.contextTokens,
      contextWindow: 0,
      contextWindowIsAuthoritative: false,
      inputTokens: overrides.inputTokens,
      model: 'gemini-3.8-flash-low',
      percentage: 0,
    },
    sessionId: overrides.sessionId,
  };
}

describe('classifyAntigravityEvent', () => {
  it('classifies the documented envelope kinds', () => {
    expect(classifyAntigravityEvent({ event: 'init' })).toBe('init');
    expect(classifyAntigravityEvent({ event: 'step_update' })).toBe('step_update');
    expect(classifyAntigravityEvent({ event: 'result' })).toBe('result');
    expect(classifyAntigravityEvent({ event: 'telemetry_sample' })).toBe('unknown');
  });

  it('recognizes the captured json-format ERROR envelope that has no event field', () => {
    const events = readAntigravityEventFixture('error-envelope.ndjson');
    expect(events).toHaveLength(1);
    expect(classifyAntigravityEvent(events[0])).toBe('result');
  });

  it('does not treat arbitrary event-less records as results', () => {
    expect(classifyAntigravityEvent({ status: 'SUCCESS' })).toBe('unknown');
    expect(classifyAntigravityEvent({ status: 'ERROR' })).toBe('unknown');
    expect(classifyAntigravityEvent({ event: null })).toBe('unknown');
  });
});

describe('readAntigravityInit', () => {
  it('reads the captured init payload', () => {
    const events = readAntigravityEventFixture('turn1-ready.ndjson');
    expect(readAntigravityInit(events[0])).toEqual({
      conversationId: TURN1_SESSION,
      model: 'gemini-3.8-flash-low',
      permissionMode: 'request-review',
    });
  });

  it('tolerates a missing model and rejects malformed init payloads', () => {
    const events = readAntigravityEventFixture('eof-before-completion.ndjson');
    expect(readAntigravityInit(events[0])).toEqual({
      conversationId: '00000000-0000-4000-8000-000000000000',
      model: null,
      permissionMode: 'request-review',
    });
    expect(readAntigravityInit({ event: 'init' })).toBeNull();
    expect(readAntigravityInit({ event: 'init', init: 'broken', conversation_id: 'c1' })).toBeNull();
  });
});

describe('readAntigravityStepUpdate', () => {
  it('reads the captured step payload', () => {
    const events = readAntigravityEventFixture('turn1-ready.ndjson');
    expect(readAntigravityStepUpdate(events[2])).toEqual({
      payload: (events[2] as { step_update: Record<string, unknown> }).step_update,
      conversationId: TURN1_SESSION,
      stepIndex: 1,
      state: 'ACTIVE',
      stepType: 'agent_response',
      textDelta: 'READY',
    });
  });

  it('rejects malformed step payloads', () => {
    expect(readAntigravityStepUpdate({ event: 'step_update', step_update: 'broken' })).toBeNull();
    expect(
      readAntigravityStepUpdate({
        event: 'step_update',
        step_update: { step_index: 'zero', state: 'DONE', step_type: 'user_input' },
      }),
    ).toBeNull();
    expect(
      readAntigravityStepUpdate({
        event: 'step_update',
        step_update: { step_index: 0, state: 3, step_type: 'user_input' },
      }),
    ).toBeNull();
    expect(
      readAntigravityStepUpdate({
        event: 'step_update',
        step_update: { step_index: 0, state: 'DONE' },
      }),
    ).toBeNull();
  });
});

describe('readAntigravityResult', () => {
  it('reads the captured result payload', () => {
    const events = readAntigravityEventFixture('turn1-ready.ndjson');
    expect(readAntigravityResult(events[4])).toMatchObject({
      conversationId: TURN1_SESSION,
      status: 'SUCCESS',
      normalizedStatus: 'success',
      response: 'READY\n',
    });
  });

  it('reads the event-less ERROR envelope with its provider error message', () => {
    const events = readAntigravityEventFixture('error-envelope.ndjson');
    expect(readAntigravityResult(events[0])).toMatchObject({
      conversationId: '',
      status: 'ERROR',
      normalizedStatus: 'error',
      error: 'invalid model selection (--model "does-not-exist-model"): model does-not-exist-model is not recognized as a known model',
    });
  });

  it('rejects malformed result payloads', () => {
    expect(readAntigravityResult({ event: 'result' })).toBeNull();
    expect(readAntigravityResult({ event: 'result', result: { status: 'SUCCESS' } })).toBeNull();
    expect(
      readAntigravityResult({ event: 'result', result: { response: '', status: 7 } }),
    ).toBeNull();
  });
});

describe('normalizeAntigravityEvent — text dedupe groups', () => {
  it('binds init metadata to the session without emitting an assistant message', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('turn1-ready.ndjson');

    expect(normalizeAntigravityEvent(events[0], state)).toEqual([]);
    expect(state.boundSessionId).toBe(TURN1_SESSION);
    expect(state.boundModel).toBe('gemini-3.8-flash-low');
    expect(getAntigravityAccumulatedText(state)).toBe('');
  });

  it('group 1 — only-final-text: the result response becomes the assistant text exactly once', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('only-final-text.ndjson');

    const chunks = events.flatMap((event) => normalizeAntigravityEvent(event, state));
    expect(chunks).toEqual([
      usageChunk({ contextTokens: 120, inputTokens: 120, sessionId: '00000000-0000-4000-8000-0000000000a1' }),
      { type: 'text', content: 'Final answer without any streamed deltas.\n' },
    ]);
    expect(getAntigravityAccumulatedText(state)).toBe('Final answer without any streamed deltas.\n');
  });

  it('group 2 — delta-plus-final: the captured turn dedupes the response against accumulated deltas', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('turn1-ready.ndjson');

    const chunks = events.flatMap((event) => normalizeAntigravityEvent(event, state));
    expect(chunks).toEqual([
      { type: 'text', content: 'READY' },
      { type: 'text', content: '\n' },
      usageChunk({ contextTokens: 28081, inputTokens: 28081, sessionId: TURN1_SESSION }),
    ]);
    expect(getAntigravityAccumulatedText(state)).toBe('READY\n');
  });

  it('group 3 — multiple assistant steps accumulate in order and dedupe against the response', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('multi-step-tools.ndjson');

    const chunks = events.flatMap((event) => normalizeAntigravityEvent(event, state));
    expect(chunks).toEqual([
      { type: 'text', content: 'Checking the note. ' },
      { type: 'text', content: 'Now writing.\n' },
      {
        type: 'tool_use',
        id: 'agy:00000000-0000-4000-8000-0000000000a2:turn0:step2',
        name: 'write_to_file',
        input: { file_path: 'notes/a.md', content: 'hello' },
      },
      {
        type: 'tool_result',
        id: 'agy:00000000-0000-4000-8000-0000000000a2:turn0:step2',
        content: 'Wrote notes/a.md',
        isError: false,
        toolUseResult: {
          name: 'write_to_file',
          parameters: { file_path: 'notes/a.md', content: 'hello' },
          output: 'Wrote notes/a.md',
          duration_seconds: 0.2,
        },
      },
      { type: 'text', content: 'Wrote the note' },
      { type: 'text', content: ' successfully.' },
      usageChunk({ contextTokens: 1500, inputTokens: 1500, sessionId: '00000000-0000-4000-8000-0000000000a2' }),
    ]);
    expect(getAntigravityAccumulatedText(state)).toBe(
      'Checking the note. Now writing.\nWrote the note successfully.',
    );
  });

  it('emits only the missing suffix when the response extends the accumulated text', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    normalizeAntigravityEvent(
      { event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'Par' } },
      state,
    );
    const chunks = normalizeAntigravityEvent(
      {
        event: 'result',
        result: { conversation_id: '', status: 'SUCCESS', response: 'Partial text', usage: {} },
      },
      state,
    );
    expect(chunks).toEqual([{ type: 'text', content: 'tial text' }]);
    expect(getAntigravityAccumulatedText(state)).toBe('Partial text');
  });

  it('counts a response mismatch instead of rendering the final text twice', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    normalizeAntigravityEvent(
      { event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'Streamed answer.' } },
      state,
    );
    const chunks = normalizeAntigravityEvent(
      {
        event: 'result',
        result: { conversation_id: '', status: 'SUCCESS', response: 'Different final answer.', usage: {} },
      },
      state,
    );
    expect(chunks).toEqual([]);
    expect(state.responseMismatchCount).toBe(1);
    expect(getAntigravityAccumulatedText(state)).toBe('Streamed answer.');
  });

  it('suppresses text deltas after the response settled', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    normalizeAntigravityEvent(
      {
        event: 'result',
        result: { conversation_id: '', status: 'SUCCESS', response: 'Done.', usage: {} },
      },
      state,
    );
    const lateDelta = normalizeAntigravityEvent(
      { event: 'step_update', step_update: { step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'LATE' } },
      state,
    );
    expect(lateDelta).toEqual([]);
    expect(getAntigravityAccumulatedText(state)).toBe('Done.');
  });
});

describe('normalizeAntigravityEvent — tools', () => {
  it('emits a tool_use/tool_result pair when a tool step jumps straight to DONE', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 3 });
    const chunks = normalizeAntigravityEvent(
      {
        event: 'step_update',
        step_update: {
          conversation_id: 'c1',
          step_index: 5,
          state: 'DONE',
          step_type: 'tool',
          tool_info: { name: 'wait', output: 'waited' },
        },
      },
      state,
    );
    expect(chunks).toEqual([
      {
        type: 'tool_use',
        id: 'agy:c1:turn3:step5',
        name: 'wait',
        input: {},
      },
      {
        type: 'tool_result',
        id: 'agy:c1:turn3:step5',
        content: 'waited',
        isError: false,
        toolUseResult: { name: 'wait', output: 'waited' },
      },
    ]);
  });

  it('suppresses repeated ACTIVE updates and duplicate terminal tool results', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const active = {
      event: 'step_update',
      step_update: {
        conversation_id: 'c1',
        step_index: 2,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_info: { name: 'run_command', parameters: { command: 'dir' } },
      },
    };
    const done = {
      event: 'step_update',
      step_update: {
        conversation_id: 'c1',
        step_index: 2,
        state: 'DONE',
        step_type: 'tool',
        tool_info: { name: 'run_command', parameters: { command: 'dir' }, output: 'listing' },
      },
    };

    expect(normalizeAntigravityEvent(active, state)).toHaveLength(1);
    expect(normalizeAntigravityEvent(active, state)).toEqual([]);
    const firstDone = normalizeAntigravityEvent(done, state);
    expect(firstDone).toHaveLength(1);
    expect(firstDone[0]).toMatchObject({ type: 'tool_result', isError: false });
    expect(normalizeAntigravityEvent(done, state)).toEqual([]);
    expect(state.duplicateToolResultCount).toBe(1);
  });

  it('marks a failed tool as an error result and never treats tool output as prose', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('tool-failure.ndjson');

    const chunks = events.flatMap((event) => normalizeAntigravityEvent(event, state));
    const toolResult = chunks.find((chunk) => chunk.type === 'tool_result');
    expect(toolResult).toMatchObject({
      id: 'agy:00000000-0000-4000-8000-0000000000a3:turn0:step1',
      content: 'Command exited with code 1',
      isError: true,
    });
    expect(chunks.filter((chunk) => chunk.type === 'text')).toEqual([
      { type: 'text', content: 'The command failed.' },
    ]);
    expect(getAntigravityAccumulatedText(state)).toBe('The command failed.');
  });

  it('ignores a stray text_delta on a tool step', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const chunks = normalizeAntigravityEvent(
      {
        event: 'step_update',
        step_update: {
          conversation_id: 'c1',
          step_index: 1,
          state: 'ACTIVE',
          step_type: 'tool',
          text_delta: 'SHOULD NOT APPEAR',
          tool_info: { name: 'wait' },
        },
      },
      state,
    );
    expect(chunks).toEqual([{ type: 'tool_use', id: 'agy:c1:turn0:step1', name: 'wait', input: {} }]);
    expect(getAntigravityAccumulatedText(state)).toBe('');
  });

  it('reports a tool step without a usable tool_info payload', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const chunks = normalizeAntigravityEvent(
      {
        event: 'step_update',
        step_update: { conversation_id: 'c1', step_index: 1, state: 'DONE', step_type: 'tool' },
      },
      state,
    );
    expect(chunks).toEqual([
      { type: 'notice', content: 'Antigravity sent a tool step without a usable tool_info payload.', level: 'warning' },
    ]);
  });
});

describe('normalizeAntigravityEvent — terminal handling and usage', () => {
  it('emits usage once per result in provider-native terms with an unknown context window', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('turn2-resume.ndjson');

    const chunks = events.flatMap((event) => normalizeAntigravityEvent(event, state));
    const usageChunks = chunks.filter((chunk) => chunk.type === 'usage');
    expect(usageChunks).toEqual([
      usageChunk({
        contextTokens: 31887,
        inputTokens: 31887,
        cacheReadInputTokens: 24483,
        sessionId: TURN1_SESSION,
      }),
    ]);
  });

  it('never emits a usage chunk from step completion events', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const chunks = normalizeAntigravityEvent(
      {
        event: 'step_update',
        step_update: {
          conversation_id: 'c1',
          step_index: 1,
          state: 'DONE',
          step_type: 'agent_response',
          text_delta: 'text',
          usage: { input_tokens: 500, output_tokens: 2, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 502 },
        },
      },
      state,
    );
    expect(chunks).toEqual([{ type: 'text', content: 'text' }]);
  });

  it('treats the event-less ERROR envelope as a failed result with its error message', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('error-envelope.ndjson');

    const chunks = normalizeAntigravityEvent(events[0], state);
    expect(chunks).toEqual([
      {
        type: 'error',
        content: 'invalid model selection (--model "does-not-exist-model"): model does-not-exist-model is not recognized as a known model',
      },
    ]);
    expect(state.finalResponseSettled).toBe(true);
    expect(getAntigravityAccumulatedText(state)).toBe('');
  });

  it('maps an unknown result status to an explicit error instead of success', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('unknown-status.ndjson');

    const chunks = events.flatMap((event) => normalizeAntigravityEvent(event, state));
    expect(chunks).toEqual([
      usageChunk({ contextTokens: 64, inputTokens: 64, sessionId: '00000000-0000-4000-8000-0000000000a6' }),
      { type: 'error', content: 'Antigravity result reported unknown status "PARKED".' },
    ]);
    expect(state.finalResponseSettled).toBe(true);
  });

  it('skips unknown events without affecting the turn', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('unknown-event.ndjson');

    const chunks = events.flatMap((event) => normalizeAntigravityEvent(event, state));
    expect(chunks).toEqual([
      { type: 'text', content: 'Hello' },
      usageChunk({ contextTokens: 40, inputTokens: 40, sessionId: '00000000-0000-4000-8000-0000000000b5' }),
    ]);
    expect(getAntigravityAccumulatedText(state)).toBe('Hello');
  });

  it('reports malformed known events instead of treating them as success', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    expect(normalizeAntigravityEvent({ event: 'init' }, state)).toEqual([
      { type: 'notice', content: 'Antigravity sent a malformed init event.', level: 'warning' },
    ]);
    expect(
      normalizeAntigravityEvent({ event: 'step_update', step_update: 'broken' }, state),
    ).toEqual([
      { type: 'notice', content: 'Antigravity sent a malformed step_update event.', level: 'warning' },
    ]);
    expect(normalizeAntigravityEvent({ event: 'result' }, state)).toEqual([
      { type: 'error', content: 'Antigravity sent a malformed result event.' },
    ]);
    expect(state.finalResponseSettled).toBe(false);
  });

  it('does not settle the turn on malformed step events and continues on valid ones', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const events = readAntigravityEventFixture('malformed-step.ndjson');

    const chunks = events.flatMap((event) => normalizeAntigravityEvent(event, state));
    expect(chunks).toEqual([
      { type: 'notice', content: 'Antigravity sent a malformed step_update event.', level: 'warning' },
      { type: 'notice', content: 'Antigravity sent a malformed step_update event.', level: 'warning' },
      usageChunk({ contextTokens: 50, inputTokens: 50, sessionId: '00000000-0000-4000-8000-0000000000b2' }),
      { type: 'text', content: 'Recovered.\n' },
    ]);
  });

  it('warns about a step_update with an unknown state value', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    const chunks = normalizeAntigravityEvent(
      {
        event: 'step_update',
        step_update: {
          conversation_id: 'c1',
          step_index: 1,
          state: 'PAUSED',
          step_type: 'system_message',
        },
      },
      state,
    );
    expect(chunks).toEqual([
      { type: 'notice', content: 'Antigravity step 1 reported unknown state "PAUSED".', level: 'warning' },
    ]);
  });

  it('emits nothing for silent step types such as user_input and system_message', () => {
    const state = createAntigravityEventNormalizationState({ turnIndex: 0 });
    expect(
      normalizeAntigravityEvent(
        {
          event: 'step_update',
          step_update: { conversation_id: 'c1', step_index: 0, state: 'DONE', step_type: 'user_input' },
        },
        state,
      ),
    ).toEqual([]);
    expect(
      normalizeAntigravityEvent(
        {
          event: 'step_update',
          step_update: { conversation_id: 'c1', step_index: 2, state: 'DONE', step_type: 'system_message', duration_seconds: 0.007 },
        },
        state,
      ),
    ).toEqual([]);
    expect(getAntigravityAccumulatedText(state)).toBe('');
  });
});
