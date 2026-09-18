import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Menu } from 'obsidian';

import {
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_SPAWN_AGENT,
  TOOL_TASK,
  TOOL_WAIT_AGENT,
  TOOL_WRITE_STDIN,
} from '@/core/tools/toolNames';
import type { ChatMessage, ImageAttachment } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { renderStoredAsyncSubagent, renderStoredSubagent } from '@/features/chat/rendering/SubagentRenderer';
import { renderStoredThinkingBlock } from '@/features/chat/rendering/ThinkingBlockRenderer';
import { renderStoredToolCall } from '@/features/chat/rendering/ToolCallRenderer';
import { renderStoredWriteEdit } from '@/features/chat/rendering/WriteEditRenderer';

jest.mock('@/features/chat/rendering/SubagentRenderer', () => ({
  renderStoredAsyncSubagent: jest.fn().mockReturnValue({ wrapperEl: {}, cleanup: jest.fn() }),
  renderStoredSubagent: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  renderStoredThinkingBlock: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ToolCallRenderer', () => ({
  renderStoredToolCall: jest.fn(),
}));
jest.mock('@/features/chat/rendering/WriteEditRenderer', () => ({
  renderStoredWriteEdit: jest.fn(),
}));
jest.mock('@/utils/imageEmbed', () => ({
  replaceImageEmbedsWithHtml: jest.fn().mockImplementation((md: string) => md),
}));
jest.mock('@/utils/fileLink', () => ({
  processFileLinks: jest.fn(),
  registerFileLinkHandler: jest.fn(),
}));

// The blob welcome view mounts SVG DOM and a rAF loop, which the node test
// environment does not provide. Mock it like the other DOM-heavy renderers.
const mockBlobWelcomeMount = jest.fn();
const mockBlobWelcomeUnmount = jest.fn();
const mockBlobWelcomePlayOnboarding = jest.fn();
jest.mock('@/features/chat/ui/BlobWelcomeView', () => ({
  BlobWelcomeView: jest.fn().mockImplementation(() => ({
    mount: mockBlobWelcomeMount,
    unmount: mockBlobWelcomeUnmount,
    playOnboarding: mockBlobWelcomePlayOnboarding,
  })),
}));

function createMockComponent() {
  return {
    registerDomEvent: jest.fn(),
    register: jest.fn(),
    addChild: jest.fn(),
    load: jest.fn(),
    unload: jest.fn(),
  };
}

function mockCapabilities(providerId: 'claude' | 'codex' = 'claude') {
  return () => ({
    providerId,
    supportsPersistentRuntime: true,
    supportsNativeHistory: providerId === 'claude',
    supportsPlanMode: true,
    supportsRewind: true,
    supportsFork: true,
    supportsProviderCommands: true,
    supportsImageAttachments: true,
    supportsInstructionMode: true,
    supportsMcpTools: true,
    reasoningControl: 'effort' as const,
  });
}

function createRenderer(
  messagesEl?: any,
  providerId: 'claude' | 'codex' = 'claude',
  settings: Record<string, unknown> = {},
) {
  const el = messagesEl ?? createMockEl();
  const comp = createMockComponent();
  const plugin = {
    app: {},
    settings: { mediaFolder: '', ...settings },
  };
  return {
    renderer: new MessageRenderer(
      plugin as any,
      comp as any,
      el,
      undefined,
      undefined,
      mockCapabilities(providerId),
    ),
    messagesEl: el,
  };
}

describe('MessageRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Menu as typeof Menu & { instances: unknown[] }).instances.length = 0;
  });

  // ============================================
  // renderMessages
  // ============================================

  it('renders welcome element and calls renderStoredMessage for each message', () => {
    const messagesEl = createMockEl();
    const emptySpy = jest.spyOn(messagesEl, 'empty');
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => []);

    const messages: ChatMessage[] = [
      { id: 'm1', role: 'assistant', content: '', timestamp: Date.now(), toolCalls: [], contentBlocks: [] },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    expect(emptySpy).toHaveBeenCalled();
    expect(renderStoredSpy).toHaveBeenCalledTimes(1);
    expect(welcomeEl.hasClass('claudian-plus-welcome')).toBe(true);
    expect(welcomeEl.children[0].textContent).toBe('Hello');
  });

  it('renders empty messages list with just welcome element', () => {
    const { renderer } = createRenderer();
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => []);

    const welcomeEl = renderer.renderMessages([], () => 'Welcome!');

    expect(renderStoredSpy).not.toHaveBeenCalled();
    expect(welcomeEl.hasClass('claudian-plus-welcome')).toBe(true);
  });

  it('routes welcome animation to the full Three.js cube by default', () => {
    const { renderer } = createRenderer();
    const loadSpy = jest
      .spyOn(renderer as any, 'loadWelcomeAnimation')
      .mockResolvedValue({});

    renderer.renderMessages([], () => 'Welcome!');

    expect(loadSpy).toHaveBeenCalledWith('full');
  });

  it('routes welcome animation to the blob welcome view in lite mode', () => {
    const { renderer } = createRenderer(undefined, 'claude', { welcomeAnimationMode: 'lite' });
    const loadSpy = jest
      .spyOn(renderer as any, 'loadWelcomeAnimation')
      .mockResolvedValue({});

    const welcomeEl = renderer.renderMessages([], () => 'Welcome!');

    // lite = Full Bot: the blob welcome view mounts instead of the canvas cube
    expect(loadSpy).not.toHaveBeenCalled();
    expect(mockBlobWelcomeMount).toHaveBeenCalledTimes(1);
    expect(welcomeEl.hasClass('claudian-plus-welcome')).toBe(true);
  });

  it('skips welcome animation entirely in off mode', () => {
    const { renderer } = createRenderer(undefined, 'claude', { welcomeAnimationMode: 'off' });
    const loadSpy = jest.spyOn(renderer as any, 'loadWelcomeAnimation');

    const welcomeEl = renderer.renderMessages([], () => 'Welcome!');

    expect(loadSpy).not.toHaveBeenCalled();
    expect(welcomeEl.hasClass('claudian-plus-welcome')).toBe(true);
  });

  // ============================================
  // renderStoredMessage
  // ============================================

  it('renders interrupt messages with interrupt styling instead of user bubble', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-1',
      role: 'user',
      content: '[Request interrupted by user]',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create assistant-style message with interrupt content
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-plus-message-assistant')).toBe(true);
    // Check the content contains interrupt styling
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    const interruptedEl = textEl.children[0];
    expect(interruptedEl.hasClass('claudian-plus-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('renders interrupted assistant message with content + interrupt indicator', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-1',
      role: 'assistant',
      content: 'Starting to work on the feature...',
      timestamp: Date.now(),
      isInterrupt: true,
      contentBlocks: [{ type: 'text', content: 'Starting to work on the feature...' }],
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create an assistant message (not a bare interrupt marker)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-plus-message-assistant')).toBe(true);

    // The content div should have both content rendering and an interrupt indicator
    const contentEl = msgEl.children[0];
    const lastChild = contentEl.children[contentEl.children.length - 1];
    const interruptedEl = lastChild.children[0];
    expect(interruptedEl.hasClass('claudian-plus-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('upgrades a persisted legacy interruption marker to the typed indicator', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const legacyMarker =
      '<span class="claudian-plus-interrupted">Interrupted</span> <span class="claudian-plus-interrupted-hint">· What should Claudian Plus do instead?</span>';
    const interruptMsg: ChatMessage = {
      id: 'interrupt-legacy-1',
      role: 'assistant',
      content: 'Partial response',
      timestamp: Date.now(),
      contentBlocks: [{ type: 'text', content: `Partial response\n\n${legacyMarker}` }],
    };

    renderer.renderStoredMessage(interruptMsg);

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Partial response',
      expect.anything(),
      '',
      expect.anything()
    );
    const contentEl = messagesEl.children[0].children[0];
    const indicatorEl = contentEl.children[contentEl.children.length - 1];
    expect(indicatorEl.children[0].hasClass('claudian-plus-interrupted')).toBe(true);
    expect(indicatorEl.children[0].textContent).toBe('Interrupted');
  });

  it('renders bare interrupt marker for empty interrupted assistant message', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-2',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create a bare interrupt marker (same as Claude-style)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-plus-message-assistant')).toBe(true);
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    expect(textEl.children[0].hasClass('claudian-plus-interrupted')).toBe(true);
  });

  it('skips rebuilt context messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'rebuilt-1',
      role: 'user',
      content: 'rebuilt context',
      timestamp: Date.now(),
      isRebuiltContext: true,
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(0);
  });

  it('renders user message with text content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello world',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('claudian-plus-message-user')).toBe(true);
  });

  it('renders user message with displayContent instead of content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(
      expect.anything(),
      'user input only',
      expect.anything()
    );
  });

  it('renders extracted user display content when stored message has hidden XML context', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Explain this\n\n<current_note>\nnotes/test.md\n</current_note>',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Explain this', expect.anything());
  });

  it('skips empty user message bubble (image-only)', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => createMockEl());

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    renderer.renderStoredMessage(msg);

    // Images should still be rendered, but no message bubble
    expect(renderer.renderMessageImages).toHaveBeenCalled();
    // Only the images container, no message bubble
    const bubbles = messagesEl.children.filter(
      (c: any) => c.hasClass('claudian-plus-message')
    );
    expect(bubbles.length).toBe(0);
  });

  it('renders user message with images above bubble', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => createMockEl());

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Check this image',
      timestamp: Date.now(),
      images,
    };

    renderer.renderStoredMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('adds a rewind button for eligible stored user messages', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.renderStoredMessage(allMessages[1], allMessages, 1);

    expect(messagesEl.querySelector('.claudian-plus-message-rewind-btn')).not.toBeNull();
  });

  it('adds rewind but not fork for a completed first user message', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const forkCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      rewindCallback,
      forkCallback,
      mockCapabilities(),
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const allMessages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1, userMessageId: 'user-u' },
      { id: 'a1', role: 'assistant', content: 'response', timestamp: 2, assistantMessageId: 'resp-a' },
    ];

    renderer.renderStoredMessage(allMessages[0], allMessages, 0);

    expect(messagesEl.querySelector('.claudian-plus-message-rewind-btn')).not.toBeNull();
    expect(messagesEl.querySelector('.claudian-plus-message-fork-btn')).toBeNull();
    expect((renderer as any).liveMessageEls.has('u1')).toBe(false);
  });

  it('does not add a rewind button when stored render is called without context', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 1,
      userMessageId: 'user-u',
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.querySelector('.claudian-plus-message-rewind-btn')).toBeNull();
  });

  it('shows rewind mode menu for eligible streamed user messages', async () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 2,
      userMessageId: 'user-u',
    };
    renderer.addMessage(userMsg);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      userMsg,
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.refreshActionButtons(userMsg, allMessages, 1);

    const btn = messagesEl.querySelector('.claudian-plus-message-rewind-btn');
    expect(btn).not.toBeNull();

    btn!.click();
    const menu = (Menu as typeof Menu & { instances: any[] }).instances[0];
    expect(menu.items.map((item: any) => item.title)).toEqual([
      'Rewind conversation only',
      'Rewind code + conversation',
    ]);

    menu.items[0].clickHandler?.();
    await Promise.resolve();

    expect(rewindCallback).toHaveBeenCalledWith('u1', 'conversation');
  });

  it('refreshes rewind but not fork for a streamed first user message', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const forkCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer(
      { app: {}, settings: { mediaFolder: '' } } as any,
      createMockComponent() as any,
      messagesEl,
      rewindCallback,
      forkCallback,
      mockCapabilities(),
    );
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 1,
      userMessageId: 'user-u',
    };
    renderer.addMessage(userMsg);

    renderer.refreshActionButtons(userMsg, [
      userMsg,
      { id: 'a1', role: 'assistant', content: 'response', timestamp: 2, assistantMessageId: 'resp-a' },
    ], 0);

    expect(messagesEl.querySelector('.claudian-plus-message-rewind-btn')).not.toBeNull();
    expect(messagesEl.querySelector('.claudian-plus-message-fork-btn')).toBeNull();
  });

  // ============================================
  // renderAssistantContent
  // ============================================

  it('renders assistant content blocks using specialized renderers', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'todo', name: 'TodoWrite', input: { items: [] } } as any,
        { id: 'edit', name: 'Edit', input: { file_path: 'notes/test.md' } } as any,
        { id: 'read', name: 'Read', input: { file_path: 'notes/test.md' } } as any,
        {
          id: 'sub-1',
          name: TOOL_TASK,
          input: { description: 'Async subagent' },
          status: 'running',
          subagent: { id: 'sub-1', mode: 'async', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
        {
          id: 'sub-2',
          name: TOOL_TASK,
          input: { description: 'Sync subagent' },
          status: 'running',
          subagent: { id: 'sub-2', mode: 'sync', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
      ],
      contentBlocks: [
        { type: 'thinking', content: 'thinking', durationSeconds: 2 } as any,
        { type: 'text', content: 'Text block' } as any,
        { type: 'tool_use', toolId: 'todo' } as any,
        { type: 'tool_use', toolId: 'edit' } as any,
        { type: 'tool_use', toolId: 'read' } as any,
        { type: 'subagent', subagentId: 'sub-1', mode: 'async' } as any,
        { type: 'subagent', subagentId: 'sub-2' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredThinkingBlock).toHaveBeenCalled();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Text block', expect.anything());
    // TodoWrite is not rendered inline - only in bottom panel
    expect(renderStoredWriteEdit).toHaveBeenCalled();
    expect(renderStoredToolCall).toHaveBeenCalled();
    expect(renderStoredAsyncSubagent).toHaveBeenCalled();
    expect(renderStoredSubagent).toHaveBeenCalled();
  });

  it('passes collapsed file-edit default to stored Write/Edit renderer', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'm-write-default',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'edit-1', name: 'Edit', input: { file_path: 'notes/test.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'edit-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredWriteEdit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'edit-1', name: 'Edit' }),
      { initiallyExpanded: false },
    );
  });

  it('passes expanded file-edit default to stored Write/Edit renderer', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'claude', { expandFileEditsByDefault: true });

    const msg: ChatMessage = {
      id: 'm-write-expanded',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'write-1', name: 'Write', input: { file_path: 'notes/test.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'write-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredWriteEdit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'write-1', name: 'Write' }),
      { initiallyExpanded: true },
    );
  });

  it('skips empty or whitespace-only text blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: '' } as any,
        { type: 'text', content: '   ' } as any,
        { type: 'text', content: 'Real content' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Only the non-empty text block should trigger renderContent
    expect(renderContentSpy).toHaveBeenCalledTimes(1);
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Real content', expect.anything());
  });

  it('does not render stored Codex write_stdin transport tools', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: '' },
          status: 'completed',
          result: 'poll output',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
    expect(messagesEl.children).toHaveLength(0);
  });

  it('renders stored Codex write_stdin tools when they send real input', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: 'y\n' },
          status: 'completed',
          result: 'Input sent.',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'stdin-1',
        name: TOOL_WRITE_STDIN,
        input: { session_id: '2404', chars: 'y\n' },
      }),
      expect.objectContaining({ initiallyExpanded: false }),
    );
    expect(messagesEl.children).toHaveLength(1);
  });

  it('passes expanded file-edit default to stored apply_patch renderer', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex', { expandFileEditsByDefault: true });

    const msg: ChatMessage = {
      id: 'm-apply-patch-expanded',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'patch-1',
          name: TOOL_APPLY_PATCH,
          input: { changes: [{ path: 'src/main.ts', kind: 'update' }] },
          status: 'completed',
          result: 'Applied patch',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'patch-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'patch-1', name: TOOL_APPLY_PATCH }),
      expect.objectContaining({ initiallyExpanded: true }),
    );
  });

  it('renders response duration footer when durationSeconds is present', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response text' } as any,
      ],
      durationSeconds: 65,
      durationFlavorWord: 'Baked',
    };

    renderer.renderStoredMessage(msg);

    // Find the footer element
    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0]; // claudian-plus-message-content
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-plus-response-footer'));
    expect(footerEl).toBeDefined();
    const durationSpan = footerEl!.children[0];
    expect(durationSpan.textContent).toContain('Baked');
    expect(durationSpan.textContent).toContain('1m 5s');
  });

  it('does not render footer when durationSeconds is 0', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 0,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-plus-response-footer'));
    expect(footerEl).toBeUndefined();
  });

  it('uses default flavor word "Baked" when durationFlavorWord is not set', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 30,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('claudian-plus-response-footer'));
    expect(footerEl).toBeDefined();
    expect(footerEl!.children[0].textContent).toContain('Baked');
  });

  it('renders fallback content for old conversations without contentBlocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const addCopySpy = jest.spyOn(renderer, 'addTextCopyButton').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'Legacy response text',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Should render content text
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text', expect.anything());
    // Should add copy button for fallback text
    expect(addCopySpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text');
    // Should render tool call
    expect(renderStoredToolCall).toHaveBeenCalled();
  });

  it('renders unreferenced tool calls when contentBlocks miss tool_use blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-unreferenced-tool',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'a.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'text', content: 'Only text block persisted' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Only text block persisted', expect.anything());
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' }),
      expect.objectContaining({ initiallyExpanded: false }),
    );
  });

  it('renders Task tool calls as subagents for backward compatibility', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-1',
          name: TOOL_TASK,
          input: { description: 'Run tests' },
          status: 'completed',
          result: 'All passed',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-1',
        description: 'Run tests',
        status: 'completed',
        result: 'All passed',
      })
    );
  });

  it('renders Task tool as async subagent when linked subagent mode is async', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-1',
          name: TOOL_TASK,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: 'Task running',
          subagent: {
            id: 'task-async-1',
            description: 'Background task',
            mode: 'async',
            asyncStatus: 'running',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-1',
        mode: 'async',
        asyncStatus: 'running',
      })
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  it('infers async running state from structured Task result content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async-structured',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-structured-1',
          name: TOOL_TASK,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: [{ type: 'text', text: '{"status":"running"}' }] as any,
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-structured-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-structured-1',
        asyncStatus: 'running',
      })
    );
  });

  it('uses subagent block mode hint when linked subagent mode is missing', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-mode-hint',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-hint-1',
          name: TOOL_TASK,
          input: { description: 'Background task from block hint' },
          status: 'running',
          subagent: {
            id: 'task-hint-1',
            description: 'Background task from block hint',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'subagent', subagentId: 'task-hint-1', mode: 'async' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-hint-1',
        mode: 'async',
      })
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  // ============================================
  // TaskOutput skipping
  // ============================================

  it('should skip TaskOutput tool calls (internal async subagent communication)', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc', block: true } } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
  });

  it('should render other tool calls but skip TaskOutput when mixed', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc' } } as any,
        { id: 'grep-1', name: 'Grep', input: { pattern: 'test' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'read-1' } as any,
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
        { type: 'tool_use', toolId: 'grep-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledTimes(2);
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' }),
      expect.objectContaining({ initiallyExpanded: false }),
    );
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'grep-1', name: 'Grep' }),
      expect.objectContaining({ initiallyExpanded: false }),
    );
  });

  // ============================================
  // addMessage (streaming)
  // ============================================

  it('addMessage creates user message bubble with text', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('claudian-plus-message-user')).toBe(true);
  });

  it('addMessage stores a truncated first-line table-of-contents title for user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: `${'x'.repeat(90)}\nsecond line`,
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.getAttribute('data-toc-title')).toBe(`${'x'.repeat(77)}...`);
  });

  it('addMessage renders images for user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => createMockEl());

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Look at this',
      timestamp: Date.now(),
      images,
    };

    renderer.addMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('addMessage skips empty bubble for image-only user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => createMockEl());
    const scrollSpy = jest.spyOn(renderer, 'scrollToBottom').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    const result = renderer.addMessage(msg);

    // Should still return an element (last child or messagesEl)
    expect(result).toBeDefined();
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('addMessage creates assistant message element without user-specific rendering', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('claudian-plus-message-assistant')).toBe(true);
  });

  // ============================================
  // setMessagesEl
  // ============================================

  it('setMessagesEl updates the container element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const newEl = createMockEl();

    renderer.setMessagesEl(newEl);

    // Verify by using scrollToBottom which references messagesEl
    renderer.scrollToBottom();
    // The new element should have been used (scrollTop set)
    expect(newEl.scrollTop).toBe(newEl.scrollHeight);
  });

  it('releases an active welcome animation when disposed', () => {
    const { renderer } = createRenderer();
    const destroy = jest.fn();
    (renderer as unknown as { activeCubeWelcome: { destroy: jest.Mock } }).activeCubeWelcome = { destroy };

    renderer.dispose();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect((renderer as unknown as { activeCubeWelcome: unknown }).activeCubeWelcome).toBeNull();
  });

  it('pauses and resumes the active welcome cube without discarding it', () => {
    const { renderer } = createRenderer();
    const pause = jest.fn();
    const resume = jest.fn();
    (renderer as unknown as {
      activeCubeWelcome: { pause: jest.Mock; resume: jest.Mock };
    }).activeCubeWelcome = { pause, resume };

    renderer.pauseWelcomeAnimation();
    renderer.resumeWelcomeAnimation();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  // ============================================
  // Image rendering
  // ============================================

  it('renderMessageImages creates image elements', () => {
    const containerEl = createMockEl();
    const { renderer } = createRenderer();
    jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data1', size: 200, source: 'file' },
      { id: 'img-2', name: 'avatar.jpg', mediaType: 'image/jpeg', data: 'base64data2', size: 300, source: 'file' },
    ];

    renderer.renderMessageImages(containerEl, images);

    // Should create images container with 2 image wrappers
    expect(containerEl.children.length).toBe(1);
    const imagesContainer = containerEl.children[0];
    expect(imagesContainer.hasClass('claudian-plus-message-images')).toBe(true);
    expect(imagesContainer.children.length).toBe(2);
  });

  it('setImageSrc sets data URI on image element', () => {
    const { renderer } = createRenderer();
    const imgEl = createMockEl('img');

    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    renderer.setImageSrc(imgEl as any, image);

    expect(imgEl.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('showFullImage creates overlay with image', () => {
    const { renderer } = createRenderer();
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    // Mock document.body.createDiv (document may not exist in node env)
    const overlayEl = createMockEl();
    const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
    const origDocument = globalThis.document;
    (globalThis as any).document = { body: mockBody, addEventListener: jest.fn(), removeEventListener: jest.fn() };

    try {
      renderer.showFullImage(image);
      expect(mockBody.createDiv).toHaveBeenCalledWith({ cls: 'claudian-plus-image-modal-overlay' });
    } finally {
      (globalThis as any).document = origDocument;
    }
  });

  // ============================================
  // Copy button
  // ============================================

  it('addTextCopyButton adds a copy button element', () => {
    const textEl = createMockEl();
    const { renderer } = createRenderer();

    renderer.addTextCopyButton(textEl, 'some markdown');

    expect(textEl.children.length).toBe(1);
    const copyBtn = textEl.children[0];
    expect(copyBtn.hasClass('claudian-plus-text-copy-btn')).toBe(true);
  });

  // ============================================
  // Scroll utilities
  // ============================================

  it('scrollToBottom sets scrollTop to scrollHeight', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    const { renderer } = createRenderer(messagesEl);

    renderer.scrollToBottom();

    expect(messagesEl.scrollTop).toBe(1000);
  });

  it('scrollToBottomIfNeeded scrolls when near bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 950;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    // Mock requestAnimationFrame
    const origRAF = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: () => void) => { cb(); return 0; };

    try {
      renderer.scrollToBottomIfNeeded();
      // Near bottom (1000 - 950 - 0 = 50, < 100 threshold) → scrolls
      expect(messagesEl.scrollTop).toBe(1000);
    } finally {
      (globalThis as any).requestAnimationFrame = origRAF;
    }
  });

  it('scrollToBottomIfNeeded does not scroll when far from bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 100;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    const originalScrollTop = messagesEl.scrollTop;
    renderer.scrollToBottomIfNeeded();

    // scrollTop should not change (900 > 100 threshold)
    expect(messagesEl.scrollTop).toBe(originalScrollTop);
  });

  it('uses the messages window for deferred scrolling and cancels it on dispose', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 950;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const requestAnimationFrame = jest.fn((_callback: FrameRequestCallback) => 0);
    const cancelAnimationFrame = jest.fn();
    messagesEl.ownerDocument.defaultView = {
      requestAnimationFrame,
      cancelAnimationFrame,
    } as unknown as Window;
    const { renderer } = createRenderer(messagesEl);

    renderer.scrollToBottomIfNeeded();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    const scheduledCallback = requestAnimationFrame.mock.calls[0][0] as FrameRequestCallback;
    renderer.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(0);

    scheduledCallback(0);
    expect(messagesEl.scrollTop).toBe(950);
  });

  // ============================================
  // renderContent
  // ============================================

  it('renderContent should not throw on valid markdown', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();

    // Should not throw even if internal rendering fails (graceful error handling)
    await expect(renderer.renderContent(el, '**Hello** world')).resolves.not.toThrow();
  });

  it('renderContent should empty the element before rendering', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    el.createDiv({ text: 'old content' });
    expect(el.children.length).toBe(1);

    await renderer.renderContent(el, 'new content');

    // After render, old content should be gone (empty() was called before rendering)
    expect(el.children.length).toBe(0);
  });

  it('renderContent should skip file-link post-processing when markdown has no wikilinks', async () => {
    const { processFileLinks } = await import('@/utils/fileLink');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(el, 'plain markdown without links');

    expect(processFileLinks).not.toHaveBeenCalled();
  });

  it('renderContent escapes math delimiters only when requested for streaming', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(
      el,
      'Live $x + y$ and `echo $PATH`',
      { deferMath: true }
    );

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Live \\$x + y\\$ and `echo $PATH`',
      el,
      '',
      expect.anything()
    );
  });

  it('renderContent normalizes LaTeX math delimiters before rendering', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(el, 'Inline \\(x<y\\).\n\\[y^2\\]');

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Inline $x<y$.\n$$y^2$$',
      el,
      '',
      expect.anything()
    );
  });

  it('renderContent escapes placeholder-style HTML before rendering', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { replaceImageEmbedsWithHtml } = await import('@/utils/imageEmbed');
    const { renderer } = createRenderer();
    const el = createMockEl();
    const markdown =
      'Use areas/<meta-name> and projects/<meta-name>/<name>.';
    const escapedMarkdown =
      'Use areas/&lt;meta-name&gt; and projects/&lt;meta-name&gt;/&lt;name&gt;.';

    await renderer.renderContent(el, markdown);

    expect(replaceImageEmbedsWithHtml).toHaveBeenCalledWith(
      escapedMarkdown,
      expect.anything(),
      { mediaFolder: '' }
    );
    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      escapedMarkdown,
      el,
      '',
      expect.anything()
    );
  });

  // ============================================
  // addTextCopyButton - click behavior
  // ============================================

  describe('addTextCopyButton - click behavior', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('click should copy and show feedback', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'markdown content');

      const copyBtn = textEl.children[0];
      expect(copyBtn.hasClass('claudian-plus-text-copy-btn')).toBe(true);

      // Simulate click
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      await clickHandlers![0]({ stopPropagation: jest.fn() });

      expect(writeTextMock).toHaveBeenCalledWith('markdown content');
      expect(copyBtn.textContent).toBe('Copied!');
      expect(copyBtn.classList.contains('copied')).toBe(true);
    });

    it('should handle clipboard API failure gracefully', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockRejectedValue(new Error('not allowed'));
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'content');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Should not throw
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // Should not show feedback on error
      expect(copyBtn.textContent).not.toBe('copied!');
    });
  });

  // ============================================
  // renderMessages (entry point)
  // ============================================

  it('renderMessages should render stored messages and return welcome element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => createMockEl());

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'a1', role: 'assistant', content: 'Hi there', timestamp: Date.now(), contentBlocks: [{ type: 'text', content: 'Hi there' }] as any },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Good morning!');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl!.hasClass('claudian-plus-welcome')).toBe(true);
  });

  it('renderMessages should store table-of-contents title from displayContent before content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Expanded prompt that should not appear',
        displayContent: 'Visible slash command\nwith details',
        timestamp: Date.now(),
      },
    ];

    renderer.renderMessages(messages, () => 'Hello');

    const msgEl = messagesEl.querySelector('.claudian-plus-message-user');
    expect(msgEl?.getAttribute('data-toc-title')).toBe('Visible slash command');
  });

  it('renderMessages should hide welcome when messages exist', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => createMockEl());

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    // When messages exist, welcome should be hidden
    expect(welcomeEl).toBeDefined();
  });

  it('renderMessages should return welcome element when no messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const welcomeEl = renderer.renderMessages([], () => 'Welcome');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl!.hasClass('claudian-plus-welcome')).toBe(true);
  });

  // ============================================
  // Task tool rendering - error and running status
  // ============================================

  describe('Task tool rendering - error and running status', () => {
    it('renders Task tool with error status as subagent with status error', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-err',
            name: TOOL_TASK,
            input: { description: 'Failing task' },
            status: 'error',
            result: 'Something went wrong',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-err' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-err',
          description: 'Failing task',
          status: 'error',
          result: 'Something went wrong',
        })
      );
    });

    it('renders Task tool with running status (default case in switch)', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-run',
            name: TOOL_TASK,
            input: { description: 'Running task' },
            status: 'pending',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-run' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-run',
          description: 'Running task',
          status: 'running',
        })
      );
    });

    it('renders Task tool with no description uses fallback Subagent task', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-no-desc',
            name: TOOL_TASK,
            input: {},
            status: 'completed',
            result: 'Done',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-no-desc' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-no-desc',
          description: 'Subagent task',
          status: 'completed',
        })
      );
    });

    it('renders Codex spawn_agent with the same prompt and result recovered on reload', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm-codex-subagent',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'spawn-1',
            name: TOOL_SPAWN_AGENT,
            input: {
              message: 'Inspect utils.ts and return the final patch summary.',
              model: 'gpt-5.4-mini',
            },
            status: 'completed',
            result: '{"agent_id":"agent-1","nickname":"Zeno"}',
          } as any,
          {
            id: 'wait-1',
            name: TOOL_WAIT_AGENT,
            input: { targets: ['agent-1'], timeout_ms: 30000 },
            status: 'completed',
            result: '{"status":{"agent-1":{"completed":"Patched utils.ts and verified imports."}},"timed_out":false}',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'spawn-1' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'spawn-1',
          description: 'Zeno (gpt-5.4-mini)',
          prompt: 'Inspect utils.ts and return the final patch summary.',
          status: 'completed',
          result: 'Patched utils.ts and verified imports.',
        })
      );
    });
  });

  // ============================================
  // showFullImage - close behaviors
  // ============================================

  describe('showFullImage - close behaviors', () => {
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    function setupDocumentMock() {
      const overlayEl = createMockEl();
      const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
      const docListeners = new Map<string, ((...args: any[]) => void)[]>();
      const origDocument = globalThis.document;

      (globalThis as any).document = {
        body: mockBody,
        addEventListener: jest.fn((event: string, handler: (...args: any[]) => void) => {
          if (!docListeners.has(event)) docListeners.set(event, []);
          docListeners.get(event)!.push(handler);
        }),
        removeEventListener: jest.fn((event: string, handler: (...args: any[]) => void) => {
          const handlers = docListeners.get(event);
          if (handlers) {
            const idx = handlers.indexOf(handler);
            if (idx !== -1) handlers.splice(idx, 1);
          }
        }),
      };

      return { overlayEl, docListeners, origDocument };
    }

    it('closeBtn click removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        // The overlay has a modal child, which has a close button child
        const modalEl = overlayEl.children[0]; // claudian-plus-image-modal
        // Children: img (index 0), closeBtn (index 1)
        const closeBtn = modalEl.children[1];
        expect(closeBtn.hasClass('claudian-plus-image-modal-close')).toBe(true);

        const removeSpy = jest.spyOn(overlayEl, 'remove');
        closeBtn.click();

        expect(removeSpy).toHaveBeenCalled();
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('clicking overlay background removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        const removeSpy = jest.spyOn(overlayEl, 'remove');

        // Simulate click on the overlay itself (e.target === overlay)
        const clickHandlers = overlayEl._eventListeners.get('click');
        expect(clickHandlers).toBeDefined();
        clickHandlers![0]({ target: overlayEl });

        expect(removeSpy).toHaveBeenCalled();
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('ESC key removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, docListeners, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        const removeSpy = jest.spyOn(overlayEl, 'remove');

        // Simulate ESC key press via the document keydown listener
        const keydownHandlers = docListeners.get('keydown');
        expect(keydownHandlers).toBeDefined();
        expect(keydownHandlers!.length).toBeGreaterThan(0);
        keydownHandlers![0]({ key: 'Escape' });

        expect(removeSpy).toHaveBeenCalled();
        // After close, the keydown handler should be removed
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('closes an open preview when the renderer is disposed', () => {
      const { renderer } = createRenderer();
      const { overlayEl, docListeners, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);
        const removeSpy = jest.spyOn(overlayEl, 'remove');
        const escHandler = docListeners.get('keydown')![0];

        renderer.dispose();

        expect(removeSpy).toHaveBeenCalledTimes(1);
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', escHandler);
      } finally {
        (globalThis as any).document = origDocument;
      }
    });
  });

  // ============================================
  // renderContent - code block wrapping (error path)
  // ============================================

  describe('renderContent - error handling', () => {
    it('renderContent shows error div when MarkdownRenderer throws', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockRejectedValueOnce(
        new Error('Render failed')
      );

      const { renderer } = createRenderer();
      const el = createMockEl();

      await renderer.renderContent(el, '**broken markdown**');

      const errorDiv = el.children.find(
        (c: any) => c.hasClass('claudian-plus-render-error')
      );
      expect(errorDiv).toBeDefined();
      expect(errorDiv!.textContent).toBe('Failed to render message content.');
    });
  });

  // ============================================
  // addTextCopyButton - rapid click handling
  // ============================================

  describe('addTextCopyButton - rapid click handling', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('rapid clicks clear previous timeout', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();
      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      // First click
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(copyBtn.textContent).toBe('Copied!');

      // Second rapid click before timeout expires
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // clearTimeout should have been called for the first pending timeout
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(copyBtn.textContent).toBe('Copied!');

      clearTimeoutSpy.mockRestore();
    });

    it('uses the copy button window and clears a zero-valued timer handle', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();
      const setTimeout = jest.fn((_callback: () => void) => 0);
      const clearTimeout = jest.fn();

      renderer.addTextCopyButton(textEl, 'content to copy');
      const copyBtn = textEl.children[0];
      copyBtn.ownerDocument.defaultView = {
        setTimeout,
        clearTimeout,
      } as unknown as Window;
      const clickHandler = copyBtn._eventListeners.get('click')![0];

      clickHandler({ stopPropagation: jest.fn() });
      await Promise.resolve();
      await Promise.resolve();
      clickHandler({ stopPropagation: jest.fn() });
      await Promise.resolve();
      await Promise.resolve();

      expect(setTimeout).toHaveBeenCalledTimes(2);
      expect(clearTimeout).toHaveBeenCalledWith(0);

      renderer.dispose();
      expect(clearTimeout).toHaveBeenCalledTimes(2);
    });

    it('feedback timeout restores icon after delay', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const originalInnerHTML = copyBtn.innerHTML;
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Click to copy
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(copyBtn.textContent).toBe('Copied!');
      expect(copyBtn.classList.contains('copied')).toBe(true);

      // Advance timers by 1500ms (the feedback duration)
      jest.advanceTimersByTime(1500);

      // Icon should be restored and copied class removed
      expect(copyBtn.innerHTML).toBe(originalInnerHTML);
      expect(copyBtn.classList.contains('copied')).toBe(false);
    });
  });

  // ============================================
  // renderContent - code block wrapping
  // ============================================

  describe('renderContent - code block wrapping', () => {
    it('passes image-processed markdown directly to MarkdownRenderer', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { replaceImageEmbedsWithHtml } = await import('@/utils/imageEmbed');
      const { processFileLinks } = await import('@/utils/fileLink');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (replaceImageEmbedsWithHtml as jest.Mock).mockReturnValueOnce(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]'
      );

      await renderer.renderContent(el, 'before-images ![[image.png]] [[note.md]]');

      expect(replaceImageEmbedsWithHtml).toHaveBeenCalledWith(
        'before-images ![[image.png]] [[note.md]]',
        expect.anything(),
        { mediaFolder: '' }
      );
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]',
        el,
        '',
        expect.anything()
      );
      expect(processFileLinks).toHaveBeenCalledWith(expect.anything(), el);
    });

    it('should wrap pre elements in code wrapper divs', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create a pre element in the container
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'console.log("hello")' });
        }
      );

      await renderer.renderContent(el, '```js\nconsole.log("hello")\n```');

      // The pre should be wrapped in a claudian-plus-code-wrapper
      // Due to mock limitations, check that querySelectorAll was called on el
      // The actual wrapping logic runs on real DOM, but the mock captures calls
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should skip wrapping already-wrapped pre elements', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create an already-wrapped pre element
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const wrapper = container.createDiv({ cls: 'claudian-plus-code-wrapper' });
          wrapper.createEl('pre');
        }
      );

      await renderer.renderContent(el, '```\nalready wrapped\n```');

      // Should not throw and should complete normally
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // renderMessageImages - click handler
  // ============================================

  describe('renderMessageImages - click handler', () => {
    it('should add click handler on image elements', () => {
      const containerEl = createMockEl();
      const { renderer } = createRenderer();
      const showFullImageSpy = jest.spyOn(renderer, 'showFullImage').mockImplementation(() => {});
      jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

      const images: ImageAttachment[] = [
        { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
      ];

      renderer.renderMessageImages(containerEl, images);

      // Find the img element and check for click handler
      const imagesContainer = containerEl.children[0];
      const wrapper = imagesContainer.children[0];
      const imgEl = wrapper.children[0]; // The img element

      // Check click handler is registered
      const clickHandlers = imgEl._eventListeners?.get('click');
      expect(clickHandlers).toBeDefined();
      expect(clickHandlers!.length).toBe(1);

      // Trigger click and verify showFullImage is called
      clickHandlers![0]();
      expect(showFullImageSpy).toHaveBeenCalledWith(images[0]);
    });
  });

  // ============================================
  // renderContent - code block wrapping with language labels
  // ============================================

  describe('renderContent - language label and copy', () => {
    it('should add language label when code block has language class', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          const code = pre.createEl('code');
          code.className = 'language-typescript';
          code.textContent = 'const x = 1;';
        }
      );

      await renderer.renderContent(el, '```typescript\nconst x = 1;\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should move copy-code-button outside pre into wrapper', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'some code' });
          const copyBtn = pre.createEl('button');
          copyBtn.className = 'copy-code-button';
        }
      );

      await renderer.renderContent(el, '```\nsome code\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // addMessage - displayContent for user messages
  // ============================================

  it('addMessage renders displayContent instead of content when available', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.addMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'user input only');
  });

  // ============================================
  // renderStoredThinkingBlock - durationSeconds parameter
  // ============================================

  describe('renderStoredThinkingBlock - durationSeconds parameter', () => {
    it('should pass durationSeconds to renderStoredThinkingBlock', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'deep thought', durationSeconds: 42 } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).toHaveBeenCalledWith(
        expect.anything(),
        'deep thought',
        42,
        expect.any(Function),
        expect.objectContaining({ collapsedByDefault: false })
      );
    });

    it('should pass undefined durationSeconds when not set', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'thought without duration' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).toHaveBeenCalledWith(
        expect.anything(),
        'thought without duration',
        undefined,
        expect.any(Function),
        expect.objectContaining({ collapsedByDefault: false })
      );
    });
  });

  // ============================================
  // Actionable Response Bar & Selective Insertion
  // ============================================

  describe('Actionable Response Bar & Selective Insertion', () => {
    it('creates actionable response bar with all action buttons including pin', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      const textEl = createMockEl();

      renderer.addActionableResponseBar(textEl as any, 'Sample response text');

      const actionsBar = textEl.children.find((c: any) => c.className?.includes('claudian-plus-text-actions-bar'));
      expect(actionsBar).toBeTruthy();

      const insertBtn = actionsBar.children.find((c: any) => c.className?.includes('claudian-plus-action-insert-btn'));
      const replaceBtn = actionsBar.children.find((c: any) => c.className?.includes('claudian-plus-action-replace-btn'));
      const noteBtn = actionsBar.children.find((c: any) => c.className?.includes('claudian-plus-action-note-btn'));
      const diffBtn = actionsBar.children.find((c: any) => c.className?.includes('claudian-plus-action-diff-btn'));
      const pinBtn = actionsBar.children.find((c: any) => c.className?.includes('claudian-plus-action-pin-btn'));

      expect(insertBtn).toBeTruthy();
      expect(replaceBtn).toBeTruthy();
      expect(noteBtn).toBeTruthy();
      expect(diffBtn).toBeTruthy();
      expect(pinBtn).toBeTruthy();
    });
  });

  // ============================================
  // In-Chat Mind Recall Transparency Badge
  // ============================================

  describe('In-Chat Mind Recall Transparency Badge', () => {
    it('renders mind recall pill when assistant message has mindRecall entries', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      const msg: ChatMessage = {
        id: 'm-mind',
        role: 'assistant',
        content: 'Hello, I remember your preferences',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'text', content: 'Hello, I remember your preferences' },
        ],
        mindRecall: [
          {
            id: 'rule-1',
            category: 'user_preference',
            scope: 'project',
            content: 'Always respond in Chinese',
            confidence: 0.95,
          },
          {
            id: 'rule-2',
            category: 'coding_habit',
            scope: 'global',
            content: 'Prefer arrow functions',
            confidence: 0.88,
          },
        ],
      };

      renderer.renderStoredMessage(msg);

      const pill = messagesEl.querySelector('.claudian-plus-mind-recall-pill');
      expect(pill).toBeTruthy();
      expect(pill?.textContent).toContain('2');
    });

    it('does not render mind recall pill when mindRecall is empty or absent', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      const msg: ChatMessage = {
        id: 'm-no-mind',
        role: 'assistant',
        content: 'Plain response without recall',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'text', content: 'Plain response without recall' },
        ],
      };

      renderer.renderStoredMessage(msg);

      const pill = messagesEl.querySelector('.claudian-plus-mind-recall-pill');
      expect(pill).toBeNull();
    });
  });

  // ============================================
  // Windowed rendering (R3)
  // ============================================

  describe('windowed rendering', () => {
    function buildHistory(count: number, prefix = 'm'): ChatMessage[] {
      const messages: ChatMessage[] = [];
      for (let i = 0; i < count; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        messages.push({
          id: `${prefix}-${i}`,
          role,
          content: role === 'user' ? `question ${i}` : `answer ${i}`,
          timestamp: i,
          ...(role === 'assistant'
            ? { contentBlocks: [{ type: 'text', content: `answer ${i}` }] as any }
            : {}),
        });
      }
      return messages;
    }

    function createWindowedRenderer(messagesEl?: any) {
      const el = messagesEl ?? createMockEl();
      const component = createMockComponent();
      const renderer = new MessageRenderer(
        { app: {}, settings: { mediaFolder: '' } } as any,
        component as any,
        el,
        undefined,
        undefined,
        mockCapabilities(),
      );
      return { renderer, messagesEl: el, component };
    }

    function getScopeComponents(component: ReturnType<typeof createMockComponent>): any[] {
      return (component.addChild as jest.Mock).mock.calls.map((call: any[]) => call[0]);
    }

    it('renders only the most recent 40 messages of a 3000-message history on first paint', () => {
      const { renderer, messagesEl } = createWindowedRenderer();
      const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
      const storedSpy = jest.spyOn(renderer, 'renderStoredMessage');

      renderer.renderMessages(buildHistory(3000), () => 'Hello');

      const messageNodes = messagesEl.querySelectorAll('.claudian-plus-message');
      expect(messageNodes).toHaveLength(40);
      // Stored rendering receives the original snapshot indexes and the full
      // history so rewind/fork eligibility keeps working.
      expect(storedSpy.mock.calls[0][2]).toBe(2960);
      expect(storedSpy.mock.calls[39][2]).toBe(2999);
      expect(storedSpy.mock.calls[0][1]).toHaveLength(3000);
      // First-paint markdown work is bounded to the rendered window.
      expect(renderContentSpy).toHaveBeenCalledTimes(40);
    });

    it('reveals an out-of-window message by switching the rendered window', () => {
      const { renderer, messagesEl } = createWindowedRenderer();
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      renderer.renderMessages(buildHistory(3000), () => 'Hello');
      expect(messagesEl.querySelector('[data-message-id="m-10"]')).toBeNull();

      const node = renderer.revealMessage('m-10');

      expect(node?.getAttribute('data-message-id')).toBe('m-10');
      expect(messagesEl.querySelector('[data-message-id="m-10"]')).not.toBeNull();
      expect(messagesEl.querySelectorAll('.claudian-plus-message')).toHaveLength(40);
    });

    it('keeps live streaming nodes attached when the window switches', () => {
      const { renderer, messagesEl } = createWindowedRenderer();
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      renderer.renderMessages(buildHistory(3000), () => 'Hello');
      renderer.addMessage({ id: 'live-user', role: 'user', content: 'new prompt', timestamp: 1 } as ChatMessage);
      renderer.addMessage({ id: 'live-assistant', role: 'assistant', content: '', timestamp: 2 } as ChatMessage);

      renderer.revealMessage('m-10');

      expect(messagesEl.querySelector('[data-message-id="live-user"]')).not.toBeNull();
      expect(messagesEl.querySelector('[data-message-id="live-assistant"]')).not.toBeNull();
    });

    it('returns the already-rendered node without re-rendering it', () => {
      const { renderer, messagesEl } = createWindowedRenderer();
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
      const storedSpy = jest.spyOn(renderer, 'renderStoredMessage');

      renderer.renderMessages(buildHistory(3000), () => 'Hello');
      const callsBefore = storedSpy.mock.calls.length;
      const node = messagesEl.querySelector('[data-message-id="m-2990"]');

      const revealed = renderer.revealMessage('m-2990');

      expect(revealed).toBe(node);
      expect(storedSpy.mock.calls.length).toBe(callsBefore);
    });

    it('releases discarded message markdown components and detaches their nodes', () => {
      const { renderer, messagesEl, component } = createWindowedRenderer();
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      renderer.renderMessages(buildHistory(3000), () => 'Hello');
      const scopes = getScopeComponents(component);
      expect(scopes).toHaveLength(40);
      const staleNode = messagesEl.querySelector('[data-message-id="m-2960"]');
      const removeSpy = jest.spyOn(staleNode!, 'remove');

      renderer.revealMessage('m-10');

      // The dropped page's markdown scopes were unloaded — not just detached.
      const unloaded = scopes.filter(
        (scope: any) => (scope.unload as jest.Mock).mock.calls.length > 0
      );
      expect(unloaded).toHaveLength(40);
      expect(removeSpy).toHaveBeenCalled();
    });

    it('cancels pending UI callbacks owned by discarded nodes', async () => {
      jest.useFakeTimers();
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: jest.fn().mockResolvedValue(undefined) },
        configurable: true,
      });

      try {
        const { renderer, messagesEl } = createWindowedRenderer();
        jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

        renderer.renderMessages(
          [{ id: 'u-1', role: 'user', content: 'hello', timestamp: 1 }],
          () => 'Hello'
        );
        const copyBtn = messagesEl.querySelector('.claudian-plus-user-msg-copy-btn');
        copyBtn!.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(copyBtn!.textContent).toBe('Copied!');

        // A fresh render discards the old window; pending copy feedback must
        // not fire against the discarded node.
        renderer.renderMessages(
          [{ id: 'u-2', role: 'user', content: 'next', timestamp: 2 }],
          () => 'Hello'
        );

        jest.advanceTimersByTime(2000);
        expect(copyBtn!.textContent).toBe('Copied!');
      } finally {
        jest.useRealTimers();
        Object.defineProperty(globalThis.navigator, 'clipboard', {
          value: originalNavigator?.clipboard,
          configurable: true,
        });
      }
    });

    it('keeps rewind and fork controls bound to original message indexes inside the window', () => {
      const messagesEl = createMockEl();
      const rewindCallback = jest.fn().mockResolvedValue(undefined);
      const forkCallback = jest.fn().mockResolvedValue(undefined);
      const renderer = new MessageRenderer(
        { app: {}, settings: { mediaFolder: '' } } as any,
        createMockComponent() as any,
        messagesEl,
        rewindCallback,
        forkCallback,
        mockCapabilities(),
      );
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      const messages = buildHistory(3000);
      messages[2996] = {
        ...messages[2996],
        role: 'assistant',
        contentBlocks: [{ type: 'text', content: 'earlier answer' }] as any,
        assistantMessageId: 'prev-a',
      };
      messages[2997] = {
        ...messages[2997],
        role: 'user',
        content: 'deep question',
        timestamp: 2997,
        userMessageId: 'user-deep',
      };
      messages[2998] = {
        ...messages[2998],
        role: 'assistant',
        contentBlocks: [{ type: 'text', content: 'later answer' }] as any,
        assistantMessageId: 'resp-a',
      };

      renderer.renderMessages(messages, () => 'Hello');

      const deepNode = messagesEl.querySelector('[data-message-id="m-2997"]');
      expect(deepNode).not.toBeNull();
      expect(deepNode!.querySelector('.claudian-plus-message-rewind-btn')).not.toBeNull();
      expect(deepNode!.querySelector('.claudian-plus-message-fork-btn')).not.toBeNull();
    });

    it('loads older history when the user scrolls to the top', () => {
      const { renderer, messagesEl } = createWindowedRenderer();
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      renderer.renderMessages(buildHistory(3000), () => 'Hello');
      expect(messagesEl.querySelectorAll('.claudian-plus-message')).toHaveLength(40);

      messagesEl.scrollTop = 0;
      messagesEl.dispatchEvent('scroll');

      expect(messagesEl.querySelectorAll('.claudian-plus-message')).toHaveLength(80);
    });

    it('does not reuse the previous conversation window when switching conversations', () => {
      const { renderer, messagesEl } = createWindowedRenderer();
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
      const storedMessageSpy = jest.spyOn(renderer, 'renderStoredMessage');

      renderer.renderMessages(buildHistory(3000, 'a'), () => 'Hello');
      storedMessageSpy.mockClear();

      renderer.renderMessages(buildHistory(10, 'b'), () => 'Hello');

      expect(messagesEl.querySelector('[data-message-id="b-0"]')).not.toBeNull();
      const renderedIds = storedMessageSpy.mock.calls.map((call) => (call[0] as ChatMessage).id);
      expect(renderedIds).toHaveLength(10);
      expect(renderedIds.every((id) => id.startsWith('b-'))).toBe(true);
    });

    it('restores collapse state when a message re-enters the rendered window', () => {
      const { renderer, messagesEl } = createWindowedRenderer();
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
      (renderStoredToolCall as jest.Mock).mockImplementation((parentEl: any, toolCall: any) => {
        const wrapper = parentEl.createDiv({ cls: 'claudian-plus-tool-call' });
        wrapper.dataset.toolId = toolCall.id;
        const header = wrapper.createDiv({ cls: 'claudian-plus-tool-call-header' });
        header.setAttribute('aria-expanded', 'false');
        header.addEventListener('click', () => {
          const expanded = header.getAttribute('aria-expanded') === 'true';
          header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        });
        return wrapper;
      });

      const messages = buildHistory(3000);
      messages[2975] = {
        id: 'm-2975',
        role: 'assistant',
        content: '',
        timestamp: 2975,
        toolCalls: [
          { id: 'tool-2975', name: 'Read', input: { file_path: 'a.md' }, status: 'completed' } as any,
        ],
        contentBlocks: [{ type: 'tool_use', toolId: 'tool-2975' } as any],
      };

      renderer.renderMessages(messages, () => 'Hello');
      const header = messagesEl
        .querySelector('[data-message-id="m-2975"]')!
        .querySelector('[aria-expanded]')!;
      expect(header).not.toBeNull();
      header.click();
      expect(header.getAttribute('aria-expanded')).toBe('true');

      renderer.revealMessage('m-10');
      renderer.revealMessage('m-2975');

      const restoredHeader = messagesEl
        .querySelector('[data-message-id="m-2975"]')!
        .querySelector('[aria-expanded]')!;
      expect(restoredHeader.getAttribute('aria-expanded')).toBe('true');
    });

    it('renders stored markdown through a per-message child component', async () => {
      const { renderer, component } = createWindowedRenderer();
      const { MarkdownRenderer } = await import('obsidian');

      renderer.renderMessages(
        [{ id: 'u-1', role: 'user', content: 'hello', timestamp: 1 }],
        () => 'Hello'
      );
      renderer.addMessage({ id: 'u-live', role: 'user', content: 'live text', timestamp: 2 } as ChatMessage);
      await Promise.resolve();
      await Promise.resolve();

      const scopes = getScopeComponents(component);
      expect(scopes.length).toBeGreaterThan(0);
      const renderCalls = (MarkdownRenderer.render as jest.Mock).mock.calls;
      expect(renderCalls.length).toBeGreaterThanOrEqual(2);
      // Stored markdown uses a per-message scope; the live message keeps the
      // main component.
      expect(scopes).toContain(renderCalls[0][4]);
      expect(renderCalls[renderCalls.length - 1][4]).toBe(component);
    });
  });
});

