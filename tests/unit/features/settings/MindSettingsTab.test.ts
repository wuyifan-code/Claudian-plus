import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';
import { MindSettingsTab } from '@/features/settings/MindSettingsTab';

describe('MindSettingsTab', () => {
  let repo: MemoryRepository;
  let containerEl: MockElement;

  beforeEach(async () => {
    containerEl = createMockEl('div');
    repo = new MemoryRepository({
      storage: new InMemoryMemoryStorageAdapter(),
      vaultId: 'test-vault',
    });
    await repo.initialize();
  });

  function createTab(): MindSettingsTab {
    return new MindSettingsTab({
      containerEl: containerEl as unknown as HTMLElement,
      memoryRepository: repo,
      locale: 'en',
    });
  }

  it('renders empty review and repository sections when nothing exists', async () => {
    await createTab().render();

    expect(containerEl.querySelector('.claudian-plus-mind-settings')).not.toBeNull();
    const headers = containerEl.querySelectorAll('.claudian-plus-settings-card-header');
    expect(headers.length).toBeGreaterThanOrEqual(2);
    expect(headers[1].textContent).toContain('Review Queue (0)');
  });

  it('renders candidates and promotes one to active on approve', async () => {
    await repo.commitCandidate({
      kind: 'profile',
      claimKey: 'user.candidate_lang',
      content: 'Always reply in Chinese',
      scope: { vaultId: 'test-vault' },
      rationale: 'User command',
    });

    await createTab().render();

    const candidateCard = containerEl.querySelector('.claudian-plus-staging-card');
    expect(candidateCard).not.toBeNull();

    const approveBtn = candidateCard?.querySelector('.claudian-plus-mind-btn-approve');
    expect(approveBtn).not.toBeNull();
    approveBtn?.click();

    await new Promise((r) => setTimeout(r, 40));

    expect(await repo.listRecords({ status: 'candidate' })).toHaveLength(0);
    const active = await repo.listRecords({ status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe('Always reply in Chinese');
  });

  it('archives and suppresses a candidate on dismiss', async () => {
    await repo.commitCandidate({
      kind: 'lesson',
      claimKey: 'lesson.candidate_pnpm',
      content: 'Use pnpm only',
      scope: { vaultId: 'test-vault' },
    });

    await createTab().render();

    const dismissBtn = containerEl.querySelector('.claudian-plus-mind-btn-dismiss');
    expect(dismissBtn).not.toBeNull();
    dismissBtn?.click();

    await new Promise((r) => setTimeout(r, 40));

    expect(await repo.listRecords({ status: 'candidate' })).toHaveLength(0);
    expect(await repo.listRecords({ status: 'active' })).toHaveLength(0);
    expect((await repo.getForgetLedger()).length).toBe(1);
  });

  it('renders active records and forgets them from the repository section', async () => {
    await repo.commitExplicit({
      action: 'remember',
      kind: 'profile',
      claimKey: 'pref_lang',
      content: 'Always reply in Chinese',
      scope: { vaultId: 'test-vault' },
    });

    await createTab().render();

    const headers = containerEl.querySelectorAll('.claudian-plus-settings-card-header');
    const repoHeader = Array.from(headers).find((h) => h.textContent?.includes('Memory Repository (1)'));
    expect(repoHeader).toBeDefined();

    const deleteBtn = containerEl.querySelector('.claudian-plus-mind-btn-delete');
    expect(deleteBtn).not.toBeNull();
    deleteBtn?.click();

    await new Promise((r) => setTimeout(r, 40));
    expect(await repo.listRecords({ status: 'active' })).toHaveLength(0);
  });
});
