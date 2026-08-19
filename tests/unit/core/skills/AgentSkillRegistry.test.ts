import { createAgentSkillRegistry } from '@/core/skills/AgentSkillRegistry';
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
    listFolders: jest.fn(async (folder: string) => {
      const resolved = folder in store || folders.has(folder) ? folder : null;
      const children = resolved ? [...folders].filter(path => (
        path.startsWith(`${folder}/`) && path.slice(folder.length + 1).indexOf('/') === -1
      )) : [];
      return children;
    }),
  } as unknown as VaultFileAdapter;
}

function skillMarkdown(name: string, description: string, instructions = 'Do the work.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${instructions}\n`;
}

describe('AgentSkillRegistry', () => {
  describe('snapshot', () => {
    it('returns an empty snapshot when no sources exist', async () => {
      const registry = createAgentSkillRegistry(createMockAdapter());
      const snapshot = await registry.snapshot();
      expect(snapshot.skills).toEqual([]);
      expect(snapshot.diagnostics).toEqual([]);
    });

    it('scans every configured source, including home roots', async () => {
      const adapter = createMockAdapter({
        '.claude/skills/reviewer/SKILL.md': skillMarkdown('reviewer', 'Review code'),
        '.agents/skills/vault-extra/SKILL.md': skillMarkdown('vault-extra', 'Vault extra'),
      });
      const home = createMockAdapter({
        '.agents/skills/a-stock-analysis-1.0.0/SKILL.md': skillMarkdown('a-stock-analysis', 'A 股分析'),
      });
      const registry = createAgentSkillRegistry(adapter, home);

      const snapshot = await registry.snapshot();
      const names = snapshot.skills.map(skill => `${skill.name}|${skill.source.kind}`);
      expect(names).toEqual([
        'a-stock-analysis|home-agents',
        'reviewer|vault-claude',
        'vault-extra|vault-agents',
      ]);
    });

    it('deduplicates by name and prefers vault roots', async () => {
      const adapter = createMockAdapter({
        '.agents/skills/lark-approval/SKILL.md': skillMarkdown('lark-approval', 'Vault copy'),
      });
      const home = createMockAdapter({
        '.agents/skills/lark-approval-1.0.0/SKILL.md': skillMarkdown('lark-approval', 'Home copy'),
      });
      const registry = createAgentSkillRegistry(adapter, home);

      const snapshot = await registry.snapshot();
      const duplicates = snapshot.skills.filter(skill => skill.name === 'lark-approval');
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].scope).toBe('vault');
    });

    it('reports malformed SKILL.md files as diagnostics without throwing', async () => {
      const adapter = createMockAdapter({
        '.claude/skills/broken/SKILL.md': 'no frontmatter',
      });
      const registry = createAgentSkillRegistry(adapter);

      const snapshot = await registry.snapshot();
      expect(snapshot.skills).toEqual([]);
      expect(snapshot.diagnostics).toHaveLength(1);
      expect(snapshot.diagnostics[0].directoryPath).toBe('.claude/skills/broken');
    });
  });

  describe('caching and invalidation', () => {
    it('returns the same revision on repeated calls', async () => {
      const adapter = createMockAdapter({
        '.opencode/skills/git-release/SKILL.md': skillMarkdown('git-release', 'Release helper'),
      });
      const registry = createAgentSkillRegistry(adapter);

      const first = await registry.snapshot();
      const callsAfterFirst = (adapter.listFolders as jest.Mock).mock.calls.length;
      const second = await registry.snapshot();
      expect(first.revision).toBe(second.revision);
      expect((adapter.listFolders as jest.Mock).mock.calls.length).toBe(callsAfterFirst);
    });

    it('invalidates the cached snapshot when invalidate() is called', async () => {
      const adapter = createMockAdapter({
        '.opencode/skills/git-release/SKILL.md': 'placeholder',
      });
      const registry = createAgentSkillRegistry(adapter);

      const readMock = adapter.read as jest.Mock;
      let content = skillMarkdown('git-release', 'Release helper');
      readMock.mockImplementation(async () => content);
      const first = await registry.snapshot();

      content = skillMarkdown('git-release', 'Updated helper');
      registry.invalidate();
      const second = await registry.snapshot();
      expect(second.revision).not.toBe(first.revision);
    });

    it('notifies subscribers on invalidation', async () => {
      const registry = createAgentSkillRegistry(createMockAdapter());
      const listener = jest.fn();
      const unsubscribe = registry.subscribe(listener);
      registry.invalidate();
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
      registry.invalidate();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('load', () => {
    it('returns the full document with instructions', async () => {
      const adapter = createMockAdapter({
        '.claude/skills/reviewer/SKILL.md': skillMarkdown('reviewer', 'Review code', 'Look hard.'),
      });
      const registry = createAgentSkillRegistry(adapter);

      const document = await registry.load('reviewer');
      expect(document?.name).toBe('reviewer');
      expect(document?.instructions).toBe('Look hard.');
      expect(document?.source.kind).toBe('vault-claude');
    });

    it('returns null when the skill is not found', async () => {
      const registry = createAgentSkillRegistry(createMockAdapter());
      expect(await registry.load('missing')).toBeNull();
    });
  });
});
