import {
  dshSubagentLifecycleAdapter,
} from '@/providers/dsh/subagent/DshSubagentLifecycleAdapter';

describe('dshSubagentLifecycleAdapter', () => {
  it('classifies DSH spawn tools', () => {
    expect(dshSubagentLifecycleAdapter.isSpawnTool('subagent')).toBe(true);
    expect(dshSubagentLifecycleAdapter.isSpawnTool('subagent_fork')).toBe(true);
    expect(dshSubagentLifecycleAdapter.isSpawnTool('workflow')).toBe(true);
    expect(dshSubagentLifecycleAdapter.isSpawnTool('bash')).toBe(false);
  });

  it('hides DSH control and report tools', () => {
    expect(dshSubagentLifecycleAdapter.isHiddenTool('send_message')).toBe(true);
    expect(dshSubagentLifecycleAdapter.isHiddenTool('subagent_report')).toBe(true);
    expect(dshSubagentLifecycleAdapter.isHiddenTool('subagent')).toBe(false);
  });

  it('exposes no wait or close tools (spawn is synchronous in DSH)', () => {
    expect(dshSubagentLifecycleAdapter.isWaitTool('anything')).toBe(false);
    expect(dshSubagentLifecycleAdapter.isCloseTool('anything')).toBe(false);
    expect(dshSubagentLifecycleAdapter.resolveSpawnToolIds({} as never, new Map())).toEqual([]);
  });

  it('extracts spawn and wait results conservatively', () => {
    expect(dshSubagentLifecycleAdapter.extractSpawnResult('text')).toEqual({});
    expect(dshSubagentLifecycleAdapter.extractWaitResult('text')).toEqual({ statuses: {}, timedOut: false });
  });

  it('builds subagent info from a spawn tool call', () => {
    const info = dshSubagentLifecycleAdapter.buildSubagentInfo({
      id: 'tool-1',
      name: 'subagent',
      input: { prompt: 'Write the docs' },
      status: 'completed',
      result: 'Docs written',
    } as never);
    expect(info.id).toBe('tool-1');
    expect(info.prompt).toBe('Write the docs');
    expect(info.status).toBe('completed');
    expect(info.result).toBe('Docs written');
  });

  it('marks failed spawn tool calls as errors', () => {
    const info = dshSubagentLifecycleAdapter.buildSubagentInfo({
      id: 'tool-2',
      name: 'subagent',
      input: {},
      status: 'error',
      result: 'boom',
    } as never);
    expect(info.status).toBe('error');
    expect(info.result).toBe('boom');
  });
});
