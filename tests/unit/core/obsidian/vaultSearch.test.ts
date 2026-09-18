import type { App, TFile } from 'obsidian';

import { searchVaultNotes } from '@/core/obsidian/vaultSearch';

function createMockApp(files: Array<{ path: string; basename: string; tags?: string[]; headings?: string[]; frontmatter?: Record<string, unknown>; content?: string }>): App {
  const fileObjects: TFile[] = files.map(f => ({
    path: f.path,
    basename: f.basename,
    name: `${f.basename}.md`,
    extension: 'md',
    stat: { mtime: Date.now(), ctime: Date.now(), size: 100 },
  } as unknown as TFile));

  const cacheMap = new Map<string, any>();
  const contentMap = new Map<string, string>();
  for (const f of files) {
    cacheMap.set(f.path, {
      headings: (f.headings ?? []).map(h => ({ heading: h, level: 1 })),
      tags: (f.tags ?? []).map(t => ({ tag: `#${t}` })),
      frontmatter: f.frontmatter ?? (f.tags ? { tags: f.tags } : {}),
    });
    if (f.content) {
      contentMap.set(f.path, f.content);
    }
  }

  return {
    vault: {
      configDir: '.obsidian',
      getMarkdownFiles: jest.fn().mockReturnValue(fileObjects),
      cachedRead: jest.fn(async (file: TFile) => contentMap.get(file.path) ?? ''),
    },
    metadataCache: {
      getFileCache: jest.fn((file: TFile) => cacheMap.get(file.path) ?? null),
    },
  } as unknown as App;
}

describe('searchVaultNotes', () => {
  it('throws error when query is empty', async () => {
    const app = createMockApp([]);
    await expect(searchVaultNotes(app, '')).rejects.toThrow('Search query must be a non-empty string.');
    await expect(searchVaultNotes(app, '   ')).rejects.toThrow('Search query must be a non-empty string.');
  });

  it('matches notes by title, tag, and heading with appropriate scoring', async () => {
    const app = createMockApp([
      {
        path: 'Projects/Alpha.md',
        basename: 'Alpha Project',
        tags: ['important', 'active'],
        headings: ['Overview', 'Architecture'],
      },
      {
        path: 'Notes/Beta.md',
        basename: 'Beta Note',
        tags: ['alpha-related', 'archive'],
        headings: ['Meeting Minutes'],
      },
      {
        path: 'Notes/Gamma.md',
        basename: 'Gamma Note',
        tags: ['personal'],
        headings: ['Alpha Discussion'],
      },
      {
        path: 'Unrelated.md',
        basename: 'Unrelated Note',
        tags: ['random'],
        headings: ['Nothing Here'],
      },
    ]);

    const res = await searchVaultNotes(app, 'alpha');
    expect(res.totalMatches).toBe(3);
    expect(res.results).toHaveLength(3);

    // Title match should have highest score
    expect(res.results[0].path).toBe('Projects/Alpha.md');
    expect(res.results[0].matches).toContain('title:"alpha"');

    // Tag and heading matches
    const paths = res.results.map(r => r.path);
    expect(paths).toContain('Notes/Beta.md');
    expect(paths).toContain('Notes/Gamma.md');
    expect(paths).not.toContain('Unrelated.md');
  });

  it('filters excluded folders like .obsidian and user exclusions', async () => {
    const app = createMockApp([
      { path: '.obsidian/plugins/test.md', basename: 'test' },
      { path: 'Templates/note.md', basename: 'test note' },
      { path: 'Daily/today.md', basename: 'test daily' },
    ]);

    const res = await searchVaultNotes(app, 'test', { excludeFolders: ['Templates'] });
    expect(res.results.map(r => r.path)).toEqual(['Daily/today.md']);
  });

  it('filters nested excluded folder paths properly', async () => {
    const app = createMockApp([
      { path: 'Archive/2023/old.md', basename: 'old note' },
      { path: 'Archive/2024/new.md', basename: 'new note' },
      { path: 'Projects/active.md', basename: 'active note' },
    ]);

    const res = await searchVaultNotes(app, 'note', { excludeFolders: ['Archive/2023'] });
    const paths = res.results.map(r => r.path);
    expect(paths).toContain('Archive/2024/new.md');
    expect(paths).toContain('Projects/active.md');
    expect(paths).not.toContain('Archive/2023/old.md');
  });

  it('extracts contextual excerpts when cachedRead is available', async () => {
    const app = createMockApp([
      {
        path: 'Notes/AI.md',
        basename: 'AI Research',
        headings: ['Workflow Automation'],
        content: '---\ntags: [ai]\n---\n# Workflow Automation\nArtificial intelligence models are transforming workflow automation.',
      },
    ]);

    const res = await searchVaultNotes(app, 'automation');
    expect(res.results).toHaveLength(1);
    expect(res.results[0].excerpt).toBeDefined();
    expect(res.results[0].excerpt).toContain('transforming workflow automation');
  });

  it('respects limit parameter', async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `Notes/doc-${i}.md`,
      basename: `Document ${i}`,
    }));
    const app = createMockApp(files);

    const res = await searchVaultNotes(app, 'document', { limit: 5 });
    expect(res.totalMatches).toBe(30);
    expect(res.results).toHaveLength(5);
  });
});
