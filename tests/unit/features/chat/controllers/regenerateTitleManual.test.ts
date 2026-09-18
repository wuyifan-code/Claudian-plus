import { createMockEl } from '@test/helpers/mockElement';

import {
  ConversationController,
  type ConversationControllerDeps,
} from '@/features/chat/controllers/ConversationController';
import { ChatState } from '@/features/chat/state/ChatState';

jest.mock('@/shared/modals/ConfirmModal', () => ({
  confirm: jest.fn().mockResolvedValue(true),
}));

function createController(titleService: unknown) {
  const state = new ChatState();
  const historyDropdown = createMockEl();
  const welcomeEl = createMockEl();
  const messagesEl = createMockEl();

  const deps = {
    plugin: {
      getConversationById: jest.fn().mockResolvedValue({
        id: 'conv-1',
        title: 'Old Title',
        messages: [{ role: 'user', content: 'Hello world', displayContent: 'Hello world!' }],
      }),
      updateConversation: jest.fn().mockResolvedValue(undefined),
      renameConversation: jest.fn().mockResolvedValue(undefined),
      deleteConversation: jest.fn().mockResolvedValue(undefined),
      getConversationSync: jest.fn().mockReturnValue(null),
      getConversationList: jest.fn().mockReturnValue([]),
      findEmptyConversation: jest.fn().mockResolvedValue(null),
      createConversation: jest.fn().mockResolvedValue(null),
      switchConversation: jest.fn().mockResolvedValue(null),
      agentService: { getSessionId: jest.fn().mockResolvedValue(null), setSessionId: jest.fn() },
      settings: { userName: '', enableAutoTitleGeneration: true },
    },
    state,
    renderer: { renderMessages: jest.fn().mockReturnValue(createMockEl()) },
    subagentManager: { orphanAllActive: jest.fn(), clear: jest.fn() },
    getHistoryDropdown: () => historyDropdown,
    getWelcomeEl: () => welcomeEl,
    setWelcomeEl: () => {},
    getMessagesEl: () => messagesEl,
    getInputEl: () => ({ value: '', focus: jest.fn() }),
    getFileContextManager: () => ({
      resetForNewConversation: jest.fn(),
      resetForLoadedConversation: jest.fn(),
      autoAttachActiveFile: jest.fn(),
    }),
    getImageContextManager: () => ({ clearImages: jest.fn() }),
    getMcpServerSelector: () => ({
      clearEnabled: jest.fn(),
      getEnabledServers: jest.fn().mockResolvedValue(new Set()),
      setEnabledServers: jest.fn(),
    }),
    getExternalContextSelector: () => ({
      getExternalContexts: jest.fn().mockReturnValue([]),
      setExternalContexts: jest.fn(),
      clearExternalContexts: jest.fn(),
    }),
    clearQueuedMessage: jest.fn(),
    getTitleGenerationService: () => titleService,
    getStatusPanel: () => ({ remount: jest.fn() }),
  } as unknown as ConversationControllerDeps;

  return { controller: new ConversationController(deps), deps };
}

describe('ConversationController manual title regeneration', () => {
  it('uses the manual entry point when the provider title service exposes one', async () => {
    const titleService = {
      generateTitle: jest.fn().mockResolvedValue(undefined),
      generateTitleManually: jest.fn().mockImplementation(
        async (conversationId: string, _userMessage: string, callback: (id: string, result: unknown) => Promise<void>) => {
          await callback(conversationId, { success: true, title: 'Manual title' });
        },
      ),
      cancel: jest.fn(),
    };
    const { controller, deps } = createController(titleService);

    await controller.regenerateTitle('conv-1');

    expect(titleService.generateTitleManually).toHaveBeenCalledWith(
      'conv-1',
      'Hello world!',
      expect.any(Function),
    );
    expect(titleService.generateTitle).not.toHaveBeenCalled();
    expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'Manual title');
  });

  it('falls back to generateTitle when the service has no manual entry point', async () => {
    const titleService = {
      generateTitle: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn(),
    };
    const { controller } = createController(titleService);

    await controller.regenerateTitle('conv-1');

    expect(titleService.generateTitle).toHaveBeenCalledWith(
      'conv-1',
      'Hello world!',
      expect.any(Function),
    );
  });
});
