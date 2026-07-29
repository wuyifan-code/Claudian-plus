import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import { RuntimeSupervisor } from '@/features/chat/tabs/RuntimeSupervisor';

function createRuntime(id: string, trace: string[]): ChatRuntime {
  return {
    cleanup: () => { trace.push(`${id}:cleanup`); },
  } as unknown as ChatRuntime;
}

describe('RuntimeSupervisor', () => {
  it('owns replacement without introducing implicit cleanup semantics', () => {
    const trace: string[] = [];
    const first = createRuntime('first', trace);
    const second = createRuntime('second', trace);
    const supervisor = new RuntimeSupervisor(first);

    supervisor.setCurrent(second);

    expect(supervisor.current).toBe(second);
    expect(trace).toEqual([]);
  });

  it('keeps cleanup authoritative and clears the owned reference', () => {
    const trace: string[] = [];
    const runtime = createRuntime('runtime', trace);
    const supervisor = new RuntimeSupervisor(runtime);

    supervisor.cleanup();

    expect(trace).toEqual(['runtime:cleanup']);
    expect(supervisor.current).toBeNull();
  });

  it('detaches tab UI callbacks before tearing down the runtime', () => {
    const trace: string[] = [];
    const runtime = {
      cleanup: () => { trace.push('cleanup'); },
      setApprovalCallback: jest.fn((callback) => { trace.push(`approval:${String(callback)}`); }),
      setApprovalDismisser: jest.fn((callback) => { trace.push(`dismisser:${String(callback)}`); }),
      setAskUserQuestionCallback: jest.fn((callback) => { trace.push(`ask:${String(callback)}`); }),
      setExitPlanModeCallback: jest.fn((callback) => { trace.push(`exit:${String(callback)}`); }),
      setPermissionModeSyncCallback: jest.fn((callback) => { trace.push(`permission:${String(callback)}`); }),
      setAsyncSubagentCompletionCallback: jest.fn((callback) => { trace.push(`subagent:${String(callback)}`); }),
      setAutoTurnCallback: jest.fn((callback) => { trace.push(`auto:${String(callback)}`); }),
    } as unknown as ChatRuntime;
    const supervisor = new RuntimeSupervisor(runtime);

    supervisor.cleanup();

    expect((runtime.setApprovalCallback as jest.Mock)).toHaveBeenCalledWith(null);
    expect((runtime.setApprovalDismisser as jest.Mock)).toHaveBeenCalledWith(null);
    expect((runtime.setAskUserQuestionCallback as jest.Mock)).toHaveBeenCalledWith(null);
    expect((runtime.setExitPlanModeCallback as jest.Mock)).toHaveBeenCalledWith(null);
    expect((runtime.setPermissionModeSyncCallback as jest.Mock)).toHaveBeenCalledWith(null);
    expect((runtime.setAsyncSubagentCompletionCallback as jest.Mock)).toHaveBeenCalledWith(null);
    expect((runtime.setAutoTurnCallback as jest.Mock)).toHaveBeenCalledWith(null);
    expect(trace.at(-1)).toBe('cleanup');
  });

  it('keeps the runtime visible during cleanup and preserves it when cleanup throws', () => {
    const runtime = {
      cleanup: jest.fn(() => {
        expect(supervisor.current).toBe(runtime);
        throw new Error('cleanup failed');
      }),
    } as unknown as ChatRuntime;
    const supervisor = new RuntimeSupervisor(runtime);

    expect(() => supervisor.cleanup()).toThrow('cleanup failed');
    expect(supervisor.current).toBe(runtime);
  });
});
