import '@/providers';

import { copyFileSync,mkdtempSync,rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createMockEl } from '@test/helpers/mockElement';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { StreamChunk } from '@/core/types';
import { PermissionToggle } from '@/features/chat/ui/InputToolbar';
import { OpencodeChatRuntime } from '@/providers/opencode/runtime/OpencodeChatRuntime';

const FIXTURE_SOURCE = path.join(process.cwd(), 'tests', 'fixtures');

// The runtime writes its managed OpenCode config into the vault, so each test
// works in a throwaway copy of the fixture instead of the repo.
function createFixtureWorkspace(): string {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'claudian-oc-'));
  copyFileSync(path.join(FIXTURE_SOURCE, 'acp'), path.join(workspace, 'acp'));
  return workspace;
}

function createIntegrationPlugin(workspace: string): any {
  const settings: Record<string, unknown> = {
    model: 'opencode',
    permissionMode: 'normal',
    providerConfigs: {
      opencode: { enabled: true },
    },
    savedProviderModel: {},
    savedProviderEffort: {},
    savedProviderServiceTier: {},
    savedProviderThinkingBudget: {},
    savedProviderPermissionMode: {},
    settingsProvider: 'opencode',
  };
  const plugin: any = {
    app: {
      vault: {
        adapter: { basePath: workspace },
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

function createOpencodePermissionToggle(plugin: any): {
  label: any;
  openMenu: () => void;
  selectMode: (mode: string) => void;
  waitForChange: () => Promise<void>;
} {
  const parentEl = createMockEl();
  const callbacks = {
    getCapabilities: () => ProviderRegistry.getCapabilities('opencode'),
    getEnvironmentVariables: () => '',
    getSettings: () => ProviderSettingsCoordinator.getProviderSettingsSnapshot(plugin.settings, 'opencode'),
    getUIConfig: () => ProviderRegistry.getChatUIConfig('opencode'),
    onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
    onModelChange: jest.fn().mockResolvedValue(undefined),
    onModeChange: jest.fn().mockResolvedValue(undefined),
    onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
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

async function collectChunks(runtime: OpencodeChatRuntime, text: string): Promise<StreamChunk[]> {
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

async function closeRuntime(runtime: OpencodeChatRuntime): Promise<void> {
  runtime.cleanup();
  await (runtime as any).shutdownProcess?.();
}

describe('OpenCode sandbox tiers', () => {
  it('shows the three tiers and persists the chosen one', async () => {
    const workspace = createFixtureWorkspace();
    const plugin = createIntegrationPlugin(workspace);
    const toggle = createOpencodePermissionToggle(plugin);

    expect(toggle.label.textContent).toBe('Workspace write');

    toggle.openMenu();
    toggle.selectMode('full');
    await toggle.waitForChange();
    expect(plugin.settings.sandboxMode).toBe('full');
    expect(toggle.label.textContent).toBe('Full access');

    toggle.openMenu();
    toggle.selectMode('read');
    await toggle.waitForChange();
    expect(plugin.settings.sandboxMode).toBe('read');
    expect(toggle.label.textContent).toBe('Read only');

    rmSync(workspace, { recursive: true, force: true });
  });

  it('refuses the tool request in read-only without asking the user', async () => {
    const workspace = createFixtureWorkspace();
    const plugin = createIntegrationPlugin(workspace);
    plugin.settings.sandboxMode = 'read';
    const runtime = new OpencodeChatRuntime(plugin);
    const approvalCallback = jest.fn().mockResolvedValue('allow');
    runtime.setApprovalCallback(approvalCallback);

    try {
      const chunks = await collectChunks(runtime, 'safe permission request');

      expect(approvalCallback).not.toHaveBeenCalled();
      expect(collectText(chunks)).toContain('fixture:denied');

    } finally {
      await closeRuntime(runtime);
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('surfaces the prompt usage the ACP fixture reports', async () => {
    const workspace = createFixtureWorkspace();
    const plugin = createIntegrationPlugin(workspace);
    const runtime = new OpencodeChatRuntime(plugin);

    try {
      const chunks = await collectChunks(runtime, 'safe permission request');
      const usage = chunks.find(
        (chunk): chunk is Extract<StreamChunk, { type: 'usage' }> => chunk.type === 'usage',
      );

      expect(usage?.usage.contextTokens).toBe(1500);
      expect(usage?.usage.inputTokens).toBe(1200);

    } finally {
      await closeRuntime(runtime);
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
