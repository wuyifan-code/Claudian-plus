import type { ConsciousnessEngine } from '@/core/memory/ConsciousnessEngine';
import type { MemoryStore } from '@/core/memory/MemoryStore';
import type { MindStore } from '@/core/memory/MindStore';
import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { LegacyMemoryMigrator } from '@/core/memory/v2/migration/LegacyMemoryMigrator';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';

describe('LegacyMemoryMigrator V2', () => {
  let adapter: InMemoryMemoryStorageAdapter;
  let repo: MemoryRepository;
  let migrator: LegacyMemoryMigrator;
  const vaultId = 'test-vault-123';

  let mockMemoryStore: jest.Mocked<MemoryStore>;
  let mockMindStore: jest.Mocked<MindStore>;
  let mockConsciousness: jest.Mocked<ConsciousnessEngine>;

  beforeEach(async () => {
    adapter = new InMemoryMemoryStorageAdapter();
    repo = new MemoryRepository({ storage: adapter, vaultId });
    await repo.initialize();

    mockMemoryStore = {
      load: jest.fn().mockResolvedValue([
        {
          id: 'mem-1',
          category: 'User Preferences',
          content: 'Keep responses concise',
          source: 'user-explicit',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ]),
    } as unknown as jest.Mocked<MemoryStore>;

    mockMindStore = {
      listDurable: jest.fn().mockResolvedValue([
        {
          id: 'mind-1',
          category: 'project_rule',
          scope: 'project',
          state: 'active',
          content: 'Never edit main.js directly',
          confidence: 0.95,
          lastUsedAt: 2000,
          createdAt: 2000,
          updatedAt: 2000,
          tags: ['build'],
        },
      ]),
    } as unknown as jest.Mocked<MindStore>;

    mockConsciousness = {
      getUserProfile: jest.fn().mockResolvedValue('User is a TypeScript developer.'),
    } as unknown as jest.Mocked<ConsciousnessEngine>;

    migrator = new LegacyMemoryMigrator({
      repository: repo,
      memoryStore: mockMemoryStore,
      mindStore: mockMindStore,
      consciousness: mockConsciousness,
      vaultId,
    });
  });

  it('migrates legacy memories, durable mind rules, and user profile into V2 repository', async () => {
    const result = await migrator.migrate();
    expect(result.migratedCount).toBe(3);

    const records = await repo.listRecords({ status: 'active' });
    expect(records).toHaveLength(3);

    const memoryRec = records.find((r) => r.content === 'Keep responses concise');
    expect(memoryRec).toBeDefined();
    expect(memoryRec?.kind).toBe('profile');
    expect(memoryRec?.basis).toBe('legacy');

    const mindRec = records.find((r) => r.content === 'Never edit main.js directly');
    expect(mindRec).toBeDefined();
    expect(mindRec?.kind).toBe('project_state');
    expect(mindRec?.basis).toBe('legacy');

    const profileRec = records.find((r) => r.content === 'User is a TypeScript developer.');
    expect(profileRec).toBeDefined();
    expect(profileRec?.kind).toBe('profile');
  });

  it('is idempotent and skips re-migration if already completed', async () => {
    await migrator.migrate();
    const secondResult = await migrator.migrate();
    expect(secondResult.migratedCount).toBe(0);
    expect(secondResult.alreadyMigrated).toBe(true);

    const records = await repo.listRecords({ status: 'active' });
    expect(records).toHaveLength(3);
  });

  it('does not migrate items that are suppressed by the forget ledger', async () => {
    // Suppress "Keep responses concise" in advance
    await repo.commitExplicit({
      action: 'forget',
      content: 'Keep responses concise',
      reason: 'Previously forgotten',
      scope: { vaultId },
    });

    const result = await migrator.migrate();
    // Only 2 of the 3 should be migrated
    expect(result.migratedCount).toBe(2);

    const records = await repo.listRecords({ status: 'active' });
    expect(records.find((r) => r.content === 'Keep responses concise')).toBeUndefined();
  });
});
