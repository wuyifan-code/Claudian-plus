import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { DshCommandCatalog } from '@/providers/dsh/commands/DshCommandCatalog';

function createAdapter(files: Record<string, string>): Pick<
  VaultFileAdapter,
  'listFilesRecursive' | 'listFolders' | 'read'
> {
  return {
    async listFilesRecursive(folder: string): Promise<string[]> {
      return Object.keys(files)
        .filter((filePath) => filePath.startsWith(`${folder}/`))
        .sort();
    },
    async listFolders(folder: string): Promise<string[]> {
      const prefixes = new Set<string>();
      for (const filePath of Object.keys(files)) {
        if (!filePath.startsWith(`${folder}/`)) {
          continue;
        }
        const rest = filePath.slice(folder.length + 1);
        const slashIndex = rest.indexOf('/');
        if (slashIndex > 0) {
          prefixes.add(`${folder}/${rest.slice(0, slashIndex)}`);
        }
      }
      return [...prefixes].sort();
    },
    async read(filePath: string): Promise<string> {
      const content = files[filePath];
      if (content === undefined) {
        throw new Error(`missing file: ${filePath}`);
      }
      return content;
    },
  };
}

function createCatalog(
  files: Record<string, string>,
  homeFiles: Record<string, string> = {},
): DshCommandCatalog {
  const homeRoots = Object.keys(homeFiles).length > 0
    ? [
      { adapter: createAdapter(homeFiles), root: '.agents/skills' },
    ]
    : [];
  return new DshCommandCatalog(createAdapter(files) as never, { homeSkillRoots: homeRoots });
}

describe('DshCommandCatalog', () => {
  it('lists skills from all three SKILL.md roots', async () => {
    const catalog = createCatalog({
      '.claude/skills/review/SKILL.md': '---\ndescription: Review code\n---\nReview instructions.',
      '.codex/skills/test/SKILL.md': '---\ndescription: Write tests\n---\nTest instructions.',
      '.agents/skills/sync/SKILL.md': '---\ndescription: Sync notes\n---\nSync instructions.',
    });

    const entries = await catalog.listVaultEntries();
    const skills = entries.filter((entry) => entry.kind === 'skill');
    expect(skills.map((entry) => entry.name).sort()).toEqual(['review', 'sync', 'test']);
    expect(skills.every((entry) => entry.isEditable === false)).toBe(true);
    expect(skills.every((entry) => entry.providerId === 'dsh')).toBe(true);
    expect(skills.every((entry) => entry.scope === 'vault')).toBe(true);
  });

  it('lists home-level skills from the DSH user roots', async () => {
    const catalog = createCatalog(
      {},
      {
        '.agents/skills/blog-writer-0.1.0/SKILL.md': [
          '---',
          'name: blog-writer',
          'description: Write in my voice',
          '---',
          'Write posts.',
        ].join('\n'),
        '.agents/skills/lark-im/SKILL.md': [
          '---',
          'name: lark-im',
          'description: Lark messaging',
          '---',
          'Use lark-cli im.',
        ].join('\n'),
      },
    );

    const entries = await catalog.listVaultEntries();
    const skills = entries.filter((entry) => entry.kind === 'skill');
    expect(skills.map((entry) => entry.name).sort()).toEqual(['blog-writer', 'lark-im']);
    expect(skills.every((entry) => entry.scope === 'user')).toBe(true);
    expect(skills.find((entry) => entry.name === 'blog-writer')?.description).toBe('Write in my voice');
  });

  it('prefers the vault copy when a home skill shares its name', async () => {
    const catalog = createCatalog(
      {
        '.claude/skills/lark-im/SKILL.md': '---\ndescription: Vault copy\n---\nvault',
      },
      {
        '.agents/skills/lark-im/SKILL.md': '---\ndescription: Home copy\n---\nhome',
      },
    );

    const entries = await catalog.listVaultEntries();
    expect(entries.filter((entry) => entry.name === 'lark-im')).toHaveLength(1);
    expect(entries[0]?.description).toBe('Vault copy');
    expect(entries[0]?.scope).toBe('vault');
  });

  it('lists claude slash commands as command entries', async () => {
    const catalog = createCatalog({
      '.claude/commands/fix.md': '---\ndescription: Fix issues\n---\nFix the reported issues.',
      '.claude/commands/nested/deep.md': '---\ndescription: Deep command\n---\nDo deep work.',
    });

    const entries = await catalog.listVaultEntries();
    const commands = entries.filter((entry) => entry.kind === 'command');
    expect(commands.map((entry) => entry.name).sort()).toEqual(['deep', 'fix']);
  });

  it('dedupes skills with the same name across roots', async () => {
    const catalog = createCatalog({
      '.claude/skills/dup/SKILL.md': '---\ndescription: Claude copy\n---\nx',
      '.codex/skills/dup/SKILL.md': '---\ndescription: Codex copy\n---\nx',
    });

    const entries = await catalog.listVaultEntries();
    expect(entries.filter((entry) => entry.name === 'dup')).toHaveLength(1);
    expect(entries[0]?.description).toBe('Claude copy');
  });

  it('returns an empty list when no vault resources exist', async () => {
    const catalog = createCatalog({});
    expect(await catalog.listVaultEntries()).toEqual([]);
  });

  it('rejects mutations with a clear error', async () => {
    const catalog = createCatalog({});
    await expect(catalog.saveVaultEntry({} as never)).rejects.toThrow('read-only');
    await expect(catalog.deleteVaultEntry({} as never)).rejects.toThrow('read-only');
  });

  it('exposes the slash dropdown config', () => {
    const catalog = createCatalog({});
    expect(catalog.getDropdownConfig()).toMatchObject({
      providerId: 'dsh',
      triggerChars: ['/'],
    });
  });
});
