import { AgentSkillRepository } from '@/core/skills/AgentSkillRepository';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function createMockAdapter(files: Record<string, string> = {}): VaultFileAdapter {
  const store = { ...files };
  const folders = new Set<string>();
  for (const path of Object.keys(store)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join('/'));
    }
  }
  return {
    exists: jest.fn(async (path: string) => path in store || folders.has(path)),
    read: jest.fn(async (path: string) => {
      if (!(path in store)) throw new Error(`File not found: ${path}`);
      return store[path];
    }),
    write: jest.fn(async (path: string, content: string) => {
      store[path] = content;
    }),
    delete: jest.fn(async (path: string) => {
      delete store[path];
    }),
    listFilesRecursive: jest.fn(async () => []),
    listFiles: jest.fn(async () => []),
    listFolders: jest.fn(async (folder: string) => {
      return [...folders].filter(path => (
        path.startsWith(`${folder}/`) && path.slice(folder.length + 1).indexOf('/') === -1
      ));
    }),
    ensureFolder: jest.fn(async (path: string) => {
      const parts = path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        folders.add(parts.slice(0, i).join('/'));
      }
    }),
    rename: jest.fn(),
    stat: jest.fn(async () => ({ mtime: 1000, size: 0 })),
    deleteFolder: jest.fn(),
    removeFolderRecursive: jest.fn(async (path: string) => {
      for (const key of Object.keys(store)) {
        if (key.startsWith(`${path}/`)) delete store[key];
      }
    }),
  } as unknown as VaultFileAdapter;
}

function createMockHomeAdapter(files: Record<string, string> = {}): Pick<VaultFileAdapter, 'exists' | 'listFolders' | 'read'> {
  const store = { ...files };
  const folders = new Set<string>();
  for (const path of Object.keys(store)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join('/'));
    }
  }
  return {
    exists: jest.fn(async (path: string) => path in store || folders.has(path)),
    read: jest.fn(async (path: string) => {
      if (!(path in store)) throw new Error(`File not found: ${path}`);
      return store[path];
    }),
    listFolders: jest.fn(async (folder: string) => {
      return [...folders].filter(path => (
        path.startsWith(`${folder}/`) && path.slice(folder.length + 1).indexOf('/') === -1
      ));
    }),
  };
}

function skillMarkdown(name: string, description: string, instructions = 'Do the work.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${instructions}\n`;
}

describe('AgentSkillRepository', () => {
  describe('list', () => {
    it('returns an empty list when neither root exists', async () => {
      const repository = new AgentSkillRepository(createMockAdapter(), createMockHomeAdapter());

      const result = await repository.list();

      expect(result).toEqual({ skills: [], diagnostics: [] });
    });

    it('lists vault skills with scope "vault"', async () => {
      const adapter = createMockAdapter({
        '.agents/skills/code-reviewer/SKILL.md': skillMarkdown('code-reviewer', 'Reviews code'),
      });
      const repository = new AgentSkillRepository(adapter, createMockHomeAdapter());

      const result = await repository.list();

      expect(result.skills).toEqual([
        expect.objectContaining({
          name: 'code-reviewer',
          description: 'Reviews code',
          scope: 'vault',
          directoryPath: '.agents/skills/code-reviewer',
          filePath: '.agents/skills/code-reviewer/SKILL.md',
        }),
      ]);
      expect(result.diagnostics).toEqual([]);
    });

    it('lists home skills from versioned folders using the frontmatter name', async () => {
      const adapter = createMockAdapter();
      const homeAdapter = createMockHomeAdapter({
        '.agents/skills/a-stock-analysis-1.0.0/SKILL.md': skillMarkdown(
          'a-stock-analysis',
          'A股实时行情分析',
        ),
      });
      const repository = new AgentSkillRepository(adapter, homeAdapter);

      const result = await repository.list();

      expect(result.skills).toEqual([
        expect.objectContaining({
          name: 'a-stock-analysis',
          description: 'A股实时行情分析',
          scope: 'home',
          directoryPath: '.agents/skills/a-stock-analysis-1.0.0',
          filePath: '.agents/skills/a-stock-analysis-1.0.0/SKILL.md',
        }),
      ]);
      expect(result.diagnostics).toEqual([]);
    });

    it('prefers the vault skill when a home skill has the same name', async () => {
      const adapter = createMockAdapter({
        '.agents/skills/lark-approval/SKILL.md': skillMarkdown('lark-approval', 'Vault copy'),
      });
      const homeAdapter = createMockHomeAdapter({
        '.agents/skills/lark-approval-1.2.0/SKILL.md': skillMarkdown('lark-approval', 'Home copy'),
      });
      const repository = new AgentSkillRepository(adapter, homeAdapter);

      const result = await repository.list();

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]).toMatchObject({ name: 'lark-approval', scope: 'vault' });
    });

    it('reports malformed home packages as diagnostics', async () => {
      const adapter = createMockAdapter();
      const homeAdapter = createMockHomeAdapter({
        '.agents/skills/broken/SKILL.md': 'no frontmatter here',
      });
      const repository = new AgentSkillRepository(adapter, homeAdapter);

      const result = await repository.list();

      expect(result.skills).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].directoryPath).toBe('.agents/skills/broken');
    });

    it('scans vault and home independently when only one root exists', async () => {
      const adapter = createMockAdapter();
      const homeAdapter = createMockHomeAdapter({
        '.agents/skills/kami/SKILL.md': skillMarkdown('kami', 'Typeset documents'),
      });
      const repository = new AgentSkillRepository(adapter, homeAdapter);

      const result = await repository.list();

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]).toMatchObject({ name: 'kami', scope: 'home' });
    });
  });

  describe('mutations', () => {
    it('creates, updates, and trashes vault skills only', async () => {
      const adapter = createMockAdapter();
      const homeAdapter = createMockHomeAdapter({
        '.agents/skills/readonly/SKILL.md': skillMarkdown('readonly', 'Home skill'),
      });
      const repository = new AgentSkillRepository(adapter, homeAdapter);

      const created = await repository.create({
        name: 'code-reviewer',
        description: 'Reviews code',
        instructions: 'Check correctness.',
      });
      expect(created.scope).toBe('vault');

      const updated = await repository.update('code-reviewer', created.revision, {
        name: 'code-reviewer',
        description: 'Reviews code and tests',
        instructions: 'Check correctness and coverage.',
      });
      expect(updated.description).toBe('Reviews code and tests');

      await repository.trash('code-reviewer', updated.revision);
      const after = await repository.list();
      expect(after.skills.map(skill => skill.name)).toEqual(['readonly']);
    });

    it('rejects updates with a stale revision', async () => {
      const adapter = createMockAdapter();
      const repository = new AgentSkillRepository(adapter, createMockHomeAdapter());
      const created = await repository.create({
        name: 'code-reviewer',
        description: 'Reviews code',
        instructions: 'Check correctness.',
      });

      await expect(repository.update('code-reviewer', 'stale-revision', {
        name: 'code-reviewer',
        description: 'Changed',
        instructions: 'Changed',
      })).rejects.toThrow('changed since it was loaded');
      expect(created.description).toBe('Reviews code');
    });
  });
});
