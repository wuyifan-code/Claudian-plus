import { VaultReviewService } from '@/core/retrieval/VaultReviewService';

describe('VaultReviewService', () => {
  it('adds retrieval-backed connections to a periodic review', async () => {
    const created: Array<{ path: string; content: string }> = [];
    const recentFile = {
      path: 'notes/current.md',
      basename: 'current',
      stat: { mtime: Date.now() },
    };
    const app = {
      vault: {
        getMarkdownFiles: jest.fn(() => [recentFile]),
        cachedRead: jest.fn(async () => '# Current\n\nretrieval insight\n- [ ] Follow up on retrieval'),
        getAbstractFileByPath: jest.fn(() => null),
        getFileByPath: jest.fn(() => null),
        create: jest.fn(async (path: string, content: string) => {
          created.push({ path, content });
        }),
      },
      metadataCache: { unresolvedLinks: {}, resolvedLinks: {} },
    } as any;
    const retrieval = {
      warmup: jest.fn(async () => undefined),
      search: jest.fn(async () => [{
        path: 'notes/related.md',
        heading: 'Shared idea',
        excerpt: 'A related source-backed idea.',
      }]),
    } as any;

    const service = new VaultReviewService(app, { enabled: true, frequency: 'daily' }, retrieval);
    await service.runReview();

    expect(retrieval.warmup).toHaveBeenCalledTimes(1);
    expect(retrieval.search).toHaveBeenCalledWith('current', { limit: 3, maxExcerptLength: 180 });
    expect(created[0]?.content).toContain('[[notes/related]] > Shared idea');
    expect(created[0]?.content).toContain('## Local insight signals');
    expect(created[0]?.content).toContain('Follow up on retrieval');
  });
});
