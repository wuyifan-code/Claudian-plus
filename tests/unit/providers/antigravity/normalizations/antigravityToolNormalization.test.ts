import {
  buildAntigravityToolKey,
  readAntigravityToolInfo,
} from '@/providers/antigravity/normalizations/antigravityToolNormalization';

describe('buildAntigravityToolKey', () => {
  it('builds a stable key from session, turn, and step', () => {
    const parts = {
      conversationId: 'e848aee0-50a4-4889-9b1b-697878871fa2',
      turnIndex: 2,
      stepIndex: 4,
    };
    expect(buildAntigravityToolKey(parts)).toBe(
      'agy:e848aee0-50a4-4889-9b1b-697878871fa2:turn2:step4',
    );
    expect(buildAntigravityToolKey(parts)).toBe(buildAntigravityToolKey({ ...parts }));
  });

  it('distinguishes sessions, turns, and steps', () => {
    const base = { conversationId: 'c1', turnIndex: 0, stepIndex: 1 };
    expect(buildAntigravityToolKey(base)).not.toBe(
      buildAntigravityToolKey({ ...base, conversationId: 'c2' }),
    );
    expect(buildAntigravityToolKey(base)).not.toBe(
      buildAntigravityToolKey({ ...base, turnIndex: 1 }),
    );
    expect(buildAntigravityToolKey(base)).not.toBe(
      buildAntigravityToolKey({ ...base, stepIndex: 2 }),
    );
  });
});

describe('readAntigravityToolInfo', () => {
  it('reads the documented tool_info shape', () => {
    expect(
      readAntigravityToolInfo({
        step_index: 2,
        step_type: 'tool',
        tool_info: {
          name: 'write_to_file',
          parameters: { file_path: 'notes/a.md' },
          output: 'Wrote notes/a.md',
        },
      }),
    ).toEqual({
      name: 'write_to_file',
      parameters: { file_path: 'notes/a.md' },
      output: 'Wrote notes/a.md',
      error: null,
    });
  });

  it('reads the documented error object', () => {
    const info = readAntigravityToolInfo({
      tool_info: { name: 'run_command', error: { type: 'execution_error', message: 'exit 1' } },
    });
    expect(info?.error).toEqual({ type: 'execution_error', message: 'exit 1' });
    expect(info?.output).toBe('');
  });

  it('returns null when tool_info is missing or malformed', () => {
    expect(readAntigravityToolInfo({})).toBeNull();
    expect(readAntigravityToolInfo({ tool_info: 'broken' })).toBeNull();
    expect(readAntigravityToolInfo({ tool_info: { parameters: {} } })).toBeNull();
    expect(readAntigravityToolInfo({ tool_info: { name: '' } })).toBeNull();
    expect(readAntigravityToolInfo(null)).toBeNull();
    expect(readAntigravityToolInfo('tool')).toBeNull();
  });

  it('tolerates missing parameters and unknown error shapes', () => {
    expect(readAntigravityToolInfo({ tool_info: { name: 'wait' } })).toEqual({
      name: 'wait',
      parameters: {},
      output: '',
      error: null,
    });
    expect(
      readAntigravityToolInfo({ tool_info: { name: 'wait', error: { message: 'no type given' } } })
        ?.error,
    ).toEqual({ type: 'unknown', message: 'no type given' });
    expect(readAntigravityToolInfo({ tool_info: { name: 'wait', error: 'broken' } })?.error).toBeNull();
  });
});
