import { CodexChatRuntime } from '@/providers/codex/runtime/CodexChatRuntime';

const mockTransportRequest = jest.fn().mockResolvedValue({});
const mockTransportStart = jest.fn();
const mockProcessStart = jest.fn();
const mockProcessShutdown = jest.fn().mockResolvedValue(undefined);
const mockProcessIsAlive = jest.fn().mockReturnValue(true);

jest.mock('@/providers/codex/runtime/CodexRpcTransport', () => ({
  CodexRpcTransport: jest.fn().mockImplementation(() => ({
    request: mockTransportRequest,
    notify: jest.fn(),
    onNotification: jest.fn(),
    onServerRequest: jest.fn(),
    onClose: jest.fn(),
    offClose: jest.fn(),
    dispose: jest.fn(),
    start: mockTransportStart,
  })),
}));

jest.mock('@/providers/codex/runtime/CodexAppServerProcess', () => ({
  CodexAppServerProcess: jest.fn().mockImplementation(() => ({
    start: mockProcessStart,
    shutdown: mockProcessShutdown,
    isAlive: mockProcessIsAlive,
    onExit: jest.fn(),
    get stdin() { return {}; },
    get stdout() { return {}; },
    get stderr() { return {}; },
  })),
}));

jest.mock('@/providers/codex/runtime/codexAppServerSupport', () => ({
  resolveCodexAppServerLaunchSpec: jest.fn().mockResolvedValue({
    command: 'codex',
    args: ['app-server'],
    spawnCwd: '/test',
    targetCwd: '/test',
    target: { method: 'local', platformFamily: 'unix', platformOs: 'linux' },
    pathMapper: {
      toHostPath: (p: string) => p,
      toTargetPath: (p: string) => p,
    },
    env: {},
  }),
  initializeCodexAppServerTransport: jest.fn().mockResolvedValue({
    codexHome: '/test',
    platformOs: 'linux',
    platformFamily: 'unix',
  }),
}));

describe('CodexChatRuntime - Memory Decoupling', () => {
  it('does not rebuild app-server when memory injection text changes', async () => {
    let memoryText = 'Initial memory';
    const mockPlugin: any = {
      settings: {
        model: 'gpt-5.3-codex',
        effortLevel: 'medium',
        systemPrompt: 'Base system prompt',
        userName: 'User',
        mediaFolder: '',
        providerConfigs: {
          codex: {
            discoveredModels: [],
          },
        },
      },
      getMemoryInjectionText: jest.fn().mockImplementation(async () => memoryText),
      getConsciousnessInjectionText: jest.fn().mockResolvedValue(null),
    };

    const runtime = new CodexChatRuntime(mockPlugin);

    // First ready call: spawns app-server
    const rebuild1 = await runtime.ensureReady();
    expect(rebuild1).toBe(true);
    expect(mockProcessStart).toHaveBeenCalledTimes(1);

    // Change memory injection text
    memoryText = 'Updated new memory rules and facts!';

    // Second ready call: memory change must NOT cause rebuild or kill/restart process!
    const rebuild2 = await runtime.ensureReady();
    expect(rebuild2).toBe(false);
    expect(mockProcessShutdown).not.toHaveBeenCalled();
    expect(mockProcessStart).toHaveBeenCalledTimes(1);
  });
});
