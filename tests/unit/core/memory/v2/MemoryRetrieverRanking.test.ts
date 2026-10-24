import { MemoryRepository } from '@/core/memory/v2/MemoryRepository';
import { MemoryRetriever } from '@/core/memory/v2/MemoryRetriever';
import { InMemoryMemoryStorageAdapter } from '@/core/memory/v2/storage/MemoryStorageAdapter';
import type { MemoryContextPacket } from '@/core/memory/v2/types';

describe('MemoryRetriever ranking (BM25 + boosts)', () => {
  let repo: MemoryRepository;
  let retriever: MemoryRetriever;
  const vaultId = 'test-vault';

  beforeEach(async () => {
    repo = new MemoryRepository({ storage: new InMemoryMemoryStorageAdapter(), vaultId });
    await repo.initialize();
    retriever = new MemoryRetriever({ repository: repo });
  });

  async function remember(params: {
    content: string;
    kind?: 'profile' | 'project_state' | 'lesson';
    claimKey?: string;
    keywords?: string[];
    projectId?: string;
  }): Promise<void> {
    const record = await repo.commitExplicit({
      action: 'remember',
      kind: params.kind ?? 'profile',
      claimKey: params.claimKey ?? `pref_${Math.random().toString(36).slice(2, 8)}`,
      content: params.content,
      scope: { vaultId, ...(params.projectId ? { projectId: params.projectId } : {}) },
    });
    if (params.keywords) {
      Object.assign(record, { keywords: params.keywords });
    }
  }

  async function retrieve(userPrompt: string, projectId?: string): Promise<MemoryContextPacket> {
    return await retriever.retrieveContext({
      vaultId,
      projectId,
      userPrompt,
      activeFilePaths: [],
      now: Date.now(),
      maxTokens: 1200,
    });
  }

  it('ranks a rare-token match above records that only share ubiquitous tokens', async () => {
    // Five records share the ubiquitous term; one uniquely mentions pnpm.
    for (let i = 0; i < 5; i++) {
      await remember({ content: `构建流程说明 ${i}`, claimKey: `project.build_${i}`, kind: 'project_state' });
    }
    await remember({ content: '构建工具固定使用 pnpm', claimKey: 'project.pnpm', kind: 'project_state' });

    const packet = await retrieve('pnpm 构建');

    expect(packet.entries.length).toBeGreaterThan(0);
    expect(packet.entries[0].claimKey).toBe('project.pnpm');
    expect(packet.entries[0].reason).toContain('keyword_match');
  });

  it('matches indexed keywords even when the record content does not contain the query token', async () => {
    await remember({
      content: '发布前需要跑完整回归',
      claimKey: 'project.release',
      kind: 'project_state',
      keywords: ['deploy', '部署', 'release'],
    });

    const packet = await retrieve('部署流程是什么');

    expect(packet.entries.some((e) => e.claimKey === 'project.release')).toBe(true);
    const entry = packet.entries.find((e) => e.claimKey === 'project.release');
    expect(entry?.reason).toContain('indexed_keyword');
  });

  it('boosts memories that were referenced in earlier turns', async () => {
    await remember({ content: '数据库迁移用 alembic', claimKey: 'project.mig_a' });
    await remember({ content: '数据库迁移要写回滚脚本', claimKey: 'project.mig_b' });

    const target = (await repo.listRecords({ status: 'active' })).find(
      (r) => r.claimKey === 'project.mig_b',
    )!;
    const now = Date.now();
    await repo.recordFeedback({
      id: `fb_${now}_r`,
      memoryId: target.id,
      memoryRevision: 1,
      turnId: 't',
      type: 'referenced',
      timestamp: now,
    });

    const packet = await retrieve('数据库迁移');

    expect(packet.entries[0].claimKey).toBe('project.mig_b');
    expect(packet.entries[0].reason).toContain('feedback_referenced');
  });

  it('boosts records scoped to the active project', async () => {
    await remember({ content: '构建缓存目录放在 .cache', claimKey: 'project.cache_vault' });
    await remember({
      content: '构建缓存目录按项目隔离',
      claimKey: 'project.cache_project',
      projectId: 'repo-a',
    });

    const packet = await retrieve('构建缓存目录', 'repo-a');

    const first = packet.entries[0];
    expect(first.claimKey).toBe('project.cache_project');
    expect(first.reason).toContain('scope_project');
  });

  it('uses the rebalanced profile budget so more profiles fit', async () => {
    for (let i = 0; i < 12; i++) {
      await remember({
        content: `用户偏好条目编号 ${i}：简短说明`,
        claimKey: `user.pref_${i}`,
      });
    }

    const packet = await retrieve('无关查询');

    const profiles = packet.entries.filter((e) => e.kind === 'profile');
    expect(profiles.length).toBeGreaterThanOrEqual(10);
  });
});
