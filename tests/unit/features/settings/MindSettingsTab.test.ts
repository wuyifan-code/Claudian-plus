import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { MindStore } from '@/core/memory/MindStore';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { MindSettingsTab } from '@/features/settings/MindSettingsTab';

describe('MindSettingsTab', () => {
  let mockAdapter: jest.Mocked<VaultFileAdapter>;
  let mindStore: MindStore;
  let containerEl: MockElement;

  beforeEach(async () => {
    containerEl = createMockEl('div');
    const files: Record<string, string> = {};
    mockAdapter = {
      exists: jest.fn().mockImplementation(async (path: string) => path in files),
      read: jest.fn().mockImplementation(async (path: string) => files[path] || ''),
      write: jest.fn().mockImplementation(async (path: string, content: string) => {
        files[path] = content;
      }),
      ensureFolder: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VaultFileAdapter>;

    mindStore = new MindStore(mockAdapter);
    await mindStore.initialize();
  });

  it('renders empty staging and durable sections when no entries exist', async () => {
    const tab = new MindSettingsTab({
      containerEl: containerEl as unknown as HTMLElement,
      mindStore,
      locale: 'en',
    });

    await tab.render();

    expect(containerEl.querySelector('.claudian-plus-mind-settings')).not.toBeNull();
    const headers = containerEl.querySelectorAll('.claudian-plus-settings-card-header');
    expect(headers.length).toBeGreaterThanOrEqual(3);
    expect(headers[1].textContent).toContain('Staging Queue (0)');
    expect(headers[2].textContent).toContain('Active Durable Mind (0)');
  });

  it('renders staging entries and handles approve and dismiss clicks', async () => {
    await mindStore.addStaging({
      category: 'user_preference',
      scope: 'global',
      content: 'Always reply in Chinese',
      rationale: 'User command',
      sourceSessionId: 'sess-1',
      confidence: 0.9,
    });

    const tab = new MindSettingsTab({
      containerEl: containerEl as unknown as HTMLElement,
      mindStore,
      locale: 'en',
    });

    await tab.render();

    const stagingCard = containerEl.querySelector('.claudian-plus-staging-card');
    expect(stagingCard).not.toBeNull();
    expect(stagingCard?.querySelector('.claudian-plus-mind-rationale')?.textContent).toContain('User command');

    // Click approve button
    const approveBtn = stagingCard?.querySelector('.claudian-plus-mind-btn-approve');
    expect(approveBtn).not.toBeNull();
    approveBtn?.click();

    // Wait for async update
    await new Promise((r) => setTimeout(r, 20));

    expect(await mindStore.listStaging()).toHaveLength(0);
    expect(await mindStore.listDurable()).toHaveLength(1);
  });

  it('renders durable entries and handles delete', async () => {
    await mindStore.addDurable({
      category: 'coding_habit',
      scope: 'project',
      state: 'active',
      content: 'Use pnpm only',
      confidence: 0.95,
      tags: ['pnpm'],
    });

    const tab = new MindSettingsTab({
      containerEl: containerEl as unknown as HTMLElement,
      mindStore,
      locale: 'en',
    });

    await tab.render();

    const durableCard = containerEl.querySelector('.claudian-plus-durable-card');
    expect(durableCard).not.toBeNull();

    const deleteBtn = durableCard?.querySelector('.claudian-plus-mind-btn-delete');
    expect(deleteBtn).not.toBeNull();
    deleteBtn?.click();

    await new Promise((r) => setTimeout(r, 20));
    expect(await mindStore.listDurable()).toHaveLength(0);
  });
});
