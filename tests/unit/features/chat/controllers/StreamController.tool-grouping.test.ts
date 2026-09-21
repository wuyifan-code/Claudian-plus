import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import type { ChatMessage } from '@/core/types';
import { StreamController, type StreamControllerDeps } from '@/features/chat/controllers/StreamController';
import { ChatState } from '@/features/chat/state/ChatState';

jest.mock('@/core/tools/todo', () => ({
  parseTodoInput: jest.fn(),
}));

jest.mock('@/core/tools/toolInput', () => ({
  extractResolvedAnswers: jest.fn().mockReturnValue(undefined),
  extractResolvedAnswersFromResultText: jest.fn().mockReturnValue(undefined),
}));

jest.mock('@/features/chat/rendering/SubagentRenderer', () => ({
  createSubagentBlock: jest.fn().mockReturnValue({
    info: { id: 'task-1', description: 'test', status: 'running', toolCalls: [] },
    labelEl: { setText: jest.fn() },
  }),
  finalizeSubagentBlock: jest.fn(),
}));

jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  appendThinkingContent: jest.fn(),
  createThinkingBlock: jest.fn().mockImplementation(() => ({
    container: {},
    contentEl: {},
    content: '',
    startTime: Date.now(),
  })),
  finalizeThinkingBlock: jest.fn().mockReturnValue(0),
}));

jest.mock('@/features/chat/rendering/ToolCallRenderer', () => ({
  getToolName: jest.fn().mockReturnValue('Read'),
  getToolSummary: jest.fn().mockReturnValue('file.md'),
  isBlockedToolResult: jest.fn().mockReturnValue(false),
  renderToolCall: jest.fn().mockImplementation((parentEl?: any) => {
    const el = createMockEl('div') as any;
    el.addClass('claudian-plus-tool-call');
    if (parentEl && parentEl.appendChild) {
      parentEl.appendChild(el);
    }
    return el;
  }),
  updateToolCallResult: jest.fn(),
}));

jest.mock('@/features/chat/rendering/WriteEditRenderer', () => ({
  createWriteEditBlock: jest.fn().mockImplementation((parentEl?: any) => {
    const wrapperEl = createMockEl('div') as any;
    wrapperEl.addClass('claudian-plus-write-edit');
    if (parentEl && parentEl.appendChild) {
      parentEl.appendChild(wrapperEl);
    }
    return { wrapperEl };
  }),
  finalizeWriteEditBlock: jest.fn(),
  updateWriteEditWithDiff: jest.fn(),
}));

jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

function createMockDeps(): StreamControllerDeps {
  const state = new ChatState();
  const messagesEl = createMockEl();
  const agentService = {
    getSessionId: jest.fn().mockReturnValue('session-1'),
    loadSubagentToolCalls: jest.fn().mockResolvedValue([]),
    loadSubagentFinalResult: jest.fn().mockResolvedValue(null),
    getCapabilities: jest.fn().mockReturnValue({
      providerId: 'claude',
      supportsPlanMode: true,
      planPathPrefix: '/.claude/plans/',
    }),
  };
  const fileContextManager = {
    markFileBeingEdited: jest.fn(),
    trackEditedFile: jest.fn(),
    getAttachedFiles: jest.fn().mockReturnValue(new Set()),
    hasFilesChanged: jest.fn().mockReturnValue(false),
  };

  return {
    plugin: {
      settings: {
        permissionMode: 'yolo',
      },
      app: {
        vault: {
          adapter: {
            basePath: '/test/vault',
          },
        },
      },
    } as any,
    state,
    renderer: {
      renderContent: jest.fn(),
      addTextCopyButton: jest.fn(),
    } as any,
    subagentManager: {
      isAsyncTask: jest.fn().mockReturnValue(false),
      isPendingAsyncTask: jest.fn().mockReturnValue(false),
      isLinkedAgentOutputTool: jest.fn().mockReturnValue(false),
      handleAgentOutputToolResult: jest.fn().mockReturnValue(undefined),
      handleAgentOutputToolUse: jest.fn(),
      handleAsyncSubagentCompletion: jest.fn().mockReturnValue(undefined),
      handleTaskToolUse: jest.fn().mockReturnValue({ action: 'buffered' }),
      handleTaskToolResult: jest.fn(),
      getByTaskId: jest.fn().mockReturnValue(undefined),
      refreshAsyncSubagent: jest.fn(),
      hasPendingTask: jest.fn().mockReturnValue(false),
      renderPendingTask: jest.fn().mockReturnValue(null),
      renderPendingTaskFromTaskResult: jest.fn().mockReturnValue(null),
      getSyncSubagent: jest.fn().mockReturnValue(undefined),
      addSyncToolCall: jest.fn(),
      updateSyncToolResult: jest.fn(),
      finalizeSyncSubagent: jest.fn().mockReturnValue(null),
      resetStreamingState: jest.fn(),
      resetSpawnedCount: jest.fn(),
      subagentsSpawnedThisStream: 0,
    } as any,
    getMessagesEl: () => messagesEl,
    getFileContextManager: () => fileContextManager as any,
    updateQueueIndicator: jest.fn(),
    getAgentService: () => agentService as any,
  };
}

function createTestMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
  };
}

describe('StreamController - Tool Grouping & Auto-Collapse', () => {
  let controller: StreamController;
  let deps: StreamControllerDeps;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new StreamController(deps);
  });

  afterEach(() => {
    controller.resetStreamingState();
  });

  it('should group consecutive tool calls (>= 2) into a live tool group', async () => {
    const msg = createTestMessage();
    deps.state.currentContentEl = createMockEl();

    await controller.handleStreamChunk(
      { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.txt' } },
      msg
    );
    await controller.handleStreamChunk(
      { type: 'tool_use', id: 'call-2', name: 'read_file', input: { path: 'b.txt' } },
      msg
    );

    (controller as any).flushPendingTools();

    const children = Array.from(deps.state.currentContentEl?.children ?? []) as any[];
    const groupContainer = children.find((child: any) => child.hasClass('claudian-plus-tool-group'));
    expect(groupContainer).toBeDefined();
    expect(groupContainer?.hasClass('expanded')).toBe(true);

    const groupChildren = Array.from(groupContainer?.children ?? []) as any[];
    const listEl = groupChildren.find((child: any) => child.hasClass('claudian-plus-tool-group-list'));
    expect(listEl).toBeDefined();
    expect(listEl?.children.length).toBe(2);
  });

  it('should auto-collapse the tool group when subsequent text arrives', async () => {
    const msg = createTestMessage();
    deps.state.currentContentEl = createMockEl();

    await controller.handleStreamChunk(
      { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.txt' } },
      msg
    );
    await controller.handleStreamChunk(
      { type: 'tool_use', id: 'call-2', name: 'read_file', input: { path: 'b.txt' } },
      msg
    );
    await controller.handleStreamChunk(
      { type: 'tool_result', id: 'call-1', content: 'ok' },
      msg
    );
    await controller.handleStreamChunk(
      { type: 'tool_result', id: 'call-2', content: 'ok' },
      msg
    );

    const children = Array.from(deps.state.currentContentEl?.children ?? []) as any[];
    const groupContainer = children.find((child: any) => child.hasClass('claudian-plus-tool-group'));
    expect(groupContainer?.hasClass('expanded')).toBe(true);

    // Text chunk arrives -> auto-collapses tool group
    await controller.handleStreamChunk(
      { type: 'text', content: 'Summary of tools execution' },
      msg
    );

    expect(groupContainer?.hasClass('expanded')).toBe(false);
  });

  it('should auto-collapse the tool group on stream completion (done chunk)', async () => {
    const msg = createTestMessage();
    deps.state.currentContentEl = createMockEl();

    await controller.handleStreamChunk(
      { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.txt' } },
      msg
    );
    await controller.handleStreamChunk(
      { type: 'tool_use', id: 'call-2', name: 'read_file', input: { path: 'b.txt' } },
      msg
    );

    const children = Array.from(deps.state.currentContentEl?.children ?? []) as any[];
    const groupContainer = children.find((child: any) => child.hasClass('claudian-plus-tool-group'));
    expect(groupContainer?.hasClass('expanded')).toBe(true);

    await controller.handleStreamChunk({ type: 'done' }, msg);

    expect(groupContainer?.hasClass('expanded')).toBe(false);
  });

  it('should unwrap and not keep a group container when only a single tool call runs', async () => {
    const msg = createTestMessage();
    deps.state.currentContentEl = createMockEl();

    await controller.handleStreamChunk(
      { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.txt' } },
      msg
    );
    await controller.handleStreamChunk(
      { type: 'tool_result', id: 'call-1', content: 'ok' },
      msg
    );
    await controller.handleStreamChunk(
      { type: 'text', content: 'Finished reading.' },
      msg
    );

    const children = Array.from(deps.state.currentContentEl?.children ?? []) as any[];
    const groupContainer = children.find((child: any) => child.hasClass('claudian-plus-tool-group'));
    expect(groupContainer).toBeUndefined();

    // The single tool call element remains directly in currentContentEl
    expect(deps.state.currentContentEl?.children.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('should update group status to error when a tool call fails', async () => {
    const msg = createTestMessage();
    deps.state.currentContentEl = createMockEl();

    await controller.handleStreamChunk(
      { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.txt' } },
      msg
    );
    await controller.handleStreamChunk(
      { type: 'tool_use', id: 'call-2', name: 'read_file', input: { path: 'b.txt' } },
      msg
    );

    await controller.handleStreamChunk(
      { type: 'tool_result', id: 'call-1', content: 'all good', isError: false },
      msg
    );
    await controller.handleStreamChunk(
      { type: 'tool_result', id: 'call-2', content: 'file not found', isError: true },
      msg
    );

    const children = Array.from(deps.state.currentContentEl?.children ?? []) as any[];
    const groupContainer = children.find((child: any) => child.hasClass('claudian-plus-tool-group'));
    expect(groupContainer).toBeDefined();

    const statusEl = groupContainer?.querySelector('.claudian-plus-tool-group-status');
    expect(statusEl?.hasClass('status-error')).toBe(true);
  });
});
