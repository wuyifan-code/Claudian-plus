import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { MemoryRetriever } from '@/core/memory/v2/MemoryRetriever';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';

describe('MemoryRetriever V2', () => {
  let adapter: InMemoryMemoryStorageAdapter;
  let repo: MemoryRepository;
  let retriever: MemoryRetriever;
  const vaultId = 'test-vault-123';

  beforeEach(async () => {
    adapter = new InMemoryMemoryStorageAdapter();
    repo = new MemoryRepository({ storage: adapter, vaultId });
    await repo.initialize();
    retriever = new MemoryRetriever({ repository: repo });
  });

  describe('Hard Filtering & Scope', () => {
    it('filters out superseded, archived, and forgotten records', async () => {
      // 1. Active record
      await repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey: 'user.language',
        content: 'Use Chinese for explanations',
        scope: { vaultId },
      });

      // 2. Forgotten record
      await repo.commitExplicit({
        action: 'remember',
        kind: 'profile',
        claimKey: 'user.temp_preference',
        content: 'Temporary preference',
        scope: { vaultId },
      });
      await repo.commitExplicit({
        action: 'forget',
        claimKey: 'user.temp_preference',
        scope: { vaultId },
      });

      const packet = await retriever.retrieveContext({
        vaultId,
        userPrompt: 'Can you explain this function in Chinese?',
        activeFilePaths: [],
        now: Date.now(),
        maxTokens: 1000,
      });

      expect(packet.entries).toHaveLength(1);
      expect(packet.entries[0].claimKey).toBe('user.language');
      expect(packet.text).toContain('Use Chinese for explanations');
      expect(packet.text).not.toContain('Temporary preference');
    });

    it('isolates project-specific memories when project does not match', async () => {
      await repo.commitExplicit({
        action: 'remember',
        kind: 'project_state',
        claimKey: 'project.framework',
        content: 'Project Alpha uses Next.js',
        scope: { vaultId, projectId: 'project-alpha' },
      });

      await repo.commitExplicit({
        action: 'remember',
        kind: 'project_state',
        claimKey: 'project.framework',
        content: 'Project Beta uses Vite',
        scope: { vaultId, projectId: 'project-beta' },
      });

      const packetAlpha = await retriever.retrieveContext({
        vaultId,
        projectId: 'project-alpha',
        userPrompt: 'What framework are we using?',
        activeFilePaths: [],
        now: Date.now(),
        maxTokens: 1000,
      });

      expect(packetAlpha.entries).toHaveLength(1);
      expect(packetAlpha.text).toContain('Project Alpha uses Next.js');
      expect(packetAlpha.text).not.toContain('Project Beta uses Vite');
    });

    it('excludes expired records whose validUntil is in the past', async () => {
      const now = 1_000_000;
      await repo.commitDream({
        jobId: 'job-1',
        proposals: [
          {
            action: 'add',
            kind: 'project_state',
            claimKey: 'milestone.v1',
            content: 'Sprint 1 finishes by Friday',
            scope: { vaultId },
            evidence: [],
            validUntil: now - 1000, // Expired
          },
        ],
        adjudicatedEvents: { eventCount: 1 },
        expectedGenRevision: await repo.getCurrentGeneration(),
      });

      const packet = await retriever.retrieveContext({
        vaultId,
        userPrompt: 'Sprint status',
        activeFilePaths: [],
        now,
        maxTokens: 1000,
      });

      expect(packet.entries).toHaveLength(0);
    });
  });

  describe('Chinese N-gram and English Keyword Matching', () => {
    it('retrieves relevant lessons matching Chinese n-gram query', async () => {
      await repo.commitDream({
        jobId: 'job-2',
        proposals: [
          {
            action: 'add',
            kind: 'lesson',
            claimKey: 'fix.sqlite_warning',
            content: '使用 Node 24 运行 SQLite 会出现实验性特性警告，需要屏蔽',
            scope: { vaultId },
            evidence: [],
            conditions: ['sqlite', 'node24'],
          },
          {
            action: 'add',
            kind: 'lesson',
            claimKey: 'fix.css_layout',
            content: '使用 flex 替代 float 修复布局',
            scope: { vaultId },
            evidence: [],
          },
        ],
        adjudicatedEvents: { eventCount: 2 },
        expectedGenRevision: await repo.getCurrentGeneration(),
      });

      const packet = await retriever.retrieveContext({
        vaultId,
        userPrompt: '我们在测试中遇到了 SQLite 实验性特性警告，怎么处理？',
        activeFilePaths: [],
        now: Date.now(),
        maxTokens: 1000,
      });

      expect(packet.entries).toHaveLength(1);
      expect(packet.entries[0].claimKey).toBe('fix.sqlite_warning');
      expect(packet.text).toContain('Node 24 运行 SQLite');
    });
  });

  describe('Budget Constraints & Clean Entry Truncation', () => {
    it('respects token limits and includes traceId and entries list', async () => {
      for (let i = 0; i < 20; i++) {
        await repo.commitExplicit({
          action: 'remember',
          kind: 'profile',
          claimKey: `pref.${i}`,
          content: `Preference number ${i} which has some descriptive text`,
          scope: { vaultId },
        });
      }

      const packet = await retriever.retrieveContext({
        vaultId,
        userPrompt: 'Preference number',
        activeFilePaths: [],
        now: Date.now(),
        maxTokens: 200, // Small budget
      });

      expect(packet.traceId).toBeDefined();
      expect(packet.estimatedTokens).toBeLessThanOrEqual(200);
      expect(packet.entries.length).toBeGreaterThan(0);
      expect(packet.entries.length).toBeLessThan(20);
      // Entry should not be cut in the middle of a line
      expect(packet.text.endsWith('\n') || packet.text.endsWith('</memory-context>')).toBe(true);
    });
  });
});
