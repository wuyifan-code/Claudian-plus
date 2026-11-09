import '@/providers';

import * as path from 'node:path';

import { createMockEl } from '@test/helpers/mockElement';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { StreamChunk } from '@/core/types';
import { PermissionToggle } from '@/features/chat/ui/InputToolbar';
import { KimiChatRuntime } from '@/providers/kimi/runtime/KimiChatRuntime';

const FIXTURE_WORKSPACE = path.join(process.cwd(), 'tests', 'fixtures');

function createIntegrationPlugin(): any {
  const settings: Record<string, unknown> = {
    model: 'kimi',
    permissionMode: 'normal',
    providerConfigs: {
      kimi: { enabled: true },
    },
    savedProviderModel: {},
    savedProviderEffort: {},
    savedProviderServiceTier: {},
    savedProviderThinkingBudget: {},
    savedProviderPermissionMode: {},
    settingsProvider: 'kimi',
  };
  const plugin: any = {
    app: {
      vault: {
        adapter: { basePath: FIXTURE_WORKSPACE },
      },
    },
    getConsciousnessInjectionText: jest.fn().mockResolvedValue(null),
    getMemoryInjectionText: jest.fn().mockResolvedValue(null),
    getResolvedProviderCliPath: jest.fn().mockResolvedValue(process.execPath),
    manifest: { version: '0.0.0-test' },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    settings,
  };
  let lastMutation = Promise.resolve();
  plugin.mutateSettings = jest.fn((mutation: (current: Record<string, unknown>) => void | Promise<void>) => {
    lastMutation = Promise.resolve(mutation(settings)).then(() => plugin.saveSettings());
    return lastMutation;
  });
  plugin.waitForLastMutation = async (): Promise<void> => {
    await lastMutation;
    await Promise.resolve();
  };
  return plugin;
}

function createKimiPermissionToggle(plugin: any): {
  label: any;
  openMenu: () => void;
  selectMode: (mode: string) => void;
  waitForChange: () => Promise<void>;
} {
  const parentEl = createMockEl();
  const callbacks = {
    getCapabilities: () => ProviderRegistry.getCapabilities('kimi'),
    getEnvironmentVariables: () => '',
    getSettings: () => ProviderSettingsCoordinator.getProviderSettingsSnapshot(plugin.settings, 'kimi'),
    getUIConfig: () => ProviderRegistry.getChatUIConfig('kimi'),
    onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
    onModelChange: jest.fn().mockResolvedValue(undefined),
    onModeChange: jest.fn().mockResolvedValue(undefined),
    onPermissionModeChange: async (mode: string) => {
      await plugin.mutateSettings((settings: Record<string, unknown>) => {
        const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, 'kimi');
        const uiConfig = ProviderRegistry.getChatUIConfig('kimi');
        if (uiConfig.applyPermissionMode) {
          uiConfig.applyPermissionMode(mode, snapshot);
        } else {
          snapshot.permissionMode = mode;
        }
        ProviderSettingsCoordinator.commitProviderSettingsSnapshot(settings, 'kimi', snapshot);
      });
    },
    onSandboxModeChange: async (mode: string) => {
      await plugin.mutateSettings((settings: Record<string, unknown>) => {
        settings.sandboxMode = mode;
      });
    },
    onServiceTierChange: jest.fn().mockResolvedValue(undefined),
    onThinkingBudgetChange: jest.fn().mockResolvedValue(undefined),
  };
  new PermissionToggle(parentEl, callbacks as any);
  const button = parentEl.querySelector('.claudian-plus-permission-button');

  return {
    label: parentEl.querySelector('.claudian-plus-permission-label'),
    openMenu: () => button?.click(),
    selectMode: (mode: string) => parentEl.querySelector(`[data-sandbox-mode="${mode}"]`)?.click(),
    waitForChange: () => plugin.waitForLastMutation(),
  };
}

async function collectChunks(runtime: KimiChatRuntime, text: string): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of runtime.query(runtime.prepareTurn({ text }))) {
    chunks.push(chunk);
  }
  return chunks;
}

function collectText(chunks: StreamChunk[]): string {
  return chunks
    .filter((chunk): chunk is Extract<StreamChunk, { content: string }> => (
      'content' in chunk && typeof chunk.content === 'string'
    ))
    .map(chunk => chunk.content)
    .join('');
}

async function closeRuntime(runtime: KimiChatRuntime): Promise<void> {
  runtime.cleanup();
  await (runtime as any).shutdownProcess();
}

describe('Kimi usage reporting', () => {
  it('surfaces the prompt usage the ACP fixture reports', async () => {
    const plugin = createIntegrationPlugin();
    const runtime = new KimiChatRuntime(plugin);

    try {
      const chunks = await collectChunks(runtime, 'safe permission request');
      const usage = chunks.find(
        (chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage',
      );

      expect(usage?.usage.contextTokens).toBe(1500);
      expect(usage?.usage.inputTokens).toBe(1200);
    } finally {
      await closeRuntime(runtime);
    }
  });
});
describe('Kimi Safe/YOLO permission flow', () => {
  it('switches the real toolbar selector and persists the Kimi sandbox mode', async () => {
    const plugin = createIntegrationPlugin();
    const toggle = createKimiPermissionToggle(plugin);

    expect(toggle.label.textContent).toBe('Workspace write');

    toggle.openMenu();
    toggle.selectMode('full');
    await toggle.waitForChange();

    expect(plugin.settings.sandboxMode).toBe('full');
    expect(toggle.label.textContent).toBe('Full access');

    toggle.openMenu();
    toggle.selectMode('workspace');
    await toggle.waitForChange();

    expect(plugin.settings.sandboxMode).toBe('workspace');
    expect(toggle.label.textContent).toBe('Workspace write');
  });

  it('read-only refuses the request without asking the user', async () => {
    const plugin = createIntegrationPlugin();
    plugin.settings.sandboxMode = 'read';
    const runtime = new KimiChatRuntime(plugin);
    const approvalCallback = jest.fn().mockResolvedValue('allow');
    runtime.setApprovalCallback(approvalCallback);

    try {
      const chunks = await collectChunks(runtime, 'safe permission request');

      expect(approvalCallback).not.toHaveBeenCalled();
      expect(collectText(chunks)).toContain('fixture:denied');
    } finally {
      await closeRuntime(runtime);
    }
  });
  it('routes real ACP tool requests through Safe approval and YOLO auto-approval', async () => {
    const plugin = createIntegrationPlugin();
    const toggle = createKimiPermissionToggle(plugin);
    const runtime = new KimiChatRuntime(plugin);
    const approvalCallback = jest.fn().mockResolvedValue('deny');
    runtime.setApprovalCallback(approvalCallback);

    try {
      const safeChunks = await collectChunks(runtime, 'safe permission request');

      expect(approvalCallback).toHaveBeenCalledTimes(1);
      expect(collectText(safeChunks)).toContain('fixture:denied');

      toggle.openMenu();
      toggle.selectMode('full');
      await toggle.waitForChange();
      expect(plugin.settings.sandboxMode).toBe('full');

      const yoloChunks = await collectChunks(runtime, 'yolo permission request');

      expect(approvalCallback).toHaveBeenCalledTimes(1);
      expect(collectText(yoloChunks)).toContain('fixture:approved');
    } finally {
      await closeRuntime(runtime);
    }
  });
});
