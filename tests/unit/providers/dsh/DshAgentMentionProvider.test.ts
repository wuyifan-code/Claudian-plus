import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { DshAgentMentionProvider } from '@/providers/dsh/agents/DshAgentMentionProvider';
import { DshAgentStorage } from '@/providers/dsh/agents/DshAgentStorage';

function createAdapter(files: Record<string, string>): Pick<VaultFileAdapter, 'listFiles' | 'read'> {
  return {
    async listFiles(folder: string): Promise<string[]> {
      return Object.keys(files)
        .filter((filePath) => filePath.startsWith(`${folder}/`))
        .sort();
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

function createStorage(
  vaultFiles: Record<string, string>,
  homeFiles: Record<string, string> = {},
): DshAgentStorage {
  return new DshAgentStorage(
    createAdapter(vaultFiles) as never,
    createAdapter(homeFiles) as never,
  );
}

describe('DshAgentMentionProvider', () => {
  it('discovers Claude-style frontmatter agents from the vault', async () => {
    const provider = new DshAgentMentionProvider(createStorage({
      '.claude/agents/researcher.md': [
        '---',
        'name: researcher',
        'description: Deep research specialist',
        '---',
        'You do deep research.',
      ].join('\n'),
      '.claude/agents/no-frontmatter.md': 'just prose',
    }));
    await provider.ensureLoaded();

    const agents = provider.searchAgents('');
    expect(agents).toEqual([
      {
        description: 'Deep research specialist',
        id: 'researcher',
        name: 'researcher',
        source: 'vault',
      },
    ]);
  });

  it('discovers Codex-style toml subagents', async () => {
    const provider = new DshAgentMentionProvider(createStorage({
      '.codex/agents/builder.toml': [
        'name = "builder"',
        'description = "Builds features"',
        'developer_instructions = "Follow the plan."',
      ].join('\n'),
    }));
    await provider.ensureLoaded();

    expect(provider.searchAgents('')).toEqual([
      {
        description: 'Builds features',
        id: 'builder',
        name: 'builder',
        source: 'vault',
      },
    ]);
  });

  it('discovers home-level agents as global mentions', async () => {
    const provider = new DshAgentMentionProvider(createStorage(
      {},
      {
        '.claude/agents/wechat-article-writer.md': [
          '---',
          'name: wechat-article-writer',
          'description: Writes WeChat articles',
          '---',
          'Write in the WeChat style.',
        ].join('\n'),
        '.codex/agents/duplicate.toml': [
          'name = "duplicate"',
          'description = "Home codex agent"',
        ].join('\n'),
      },
    ));
    await provider.ensureLoaded();

    const agents = provider.searchAgents('');
    expect(agents).toContainEqual({
      description: 'Writes WeChat articles',
      id: 'wechat-article-writer',
      name: 'wechat-article-writer',
      source: 'global',
    });
  });

  it('prefers the vault agent over the home agent with the same name', async () => {
    const provider = new DshAgentMentionProvider(createStorage(
      {
        '.claude/agents/shared.md': [
          '---',
          'name: shared',
          'description: Vault copy',
          '---',
          'vault',
        ].join('\n'),
      },
      {
        '.claude/agents/shared.md': [
          '---',
          'name: shared',
          'description: Home copy',
          '---',
          'home',
        ].join('\n'),
      },
    ));
    await provider.ensureLoaded();

    const agents = provider.searchAgents('');
    expect(agents).toHaveLength(1);
    expect(agents[0]?.description).toBe('Vault copy');
    expect(agents[0]?.source).toBe('vault');
  });

  it('dedupes agents with the same name across roots (claude wins)', async () => {
    const provider = new DshAgentMentionProvider(createStorage({
      '.claude/agents/shared.md': [
        '---',
        'name: shared',
        'description: From claude',
        '---',
        'x',
      ].join('\n'),
      '.codex/agents/shared.toml': [
        'name = "shared"',
        'description = "From codex"',
      ].join('\n'),
    }));
    await provider.ensureLoaded();

    const agents = provider.searchAgents('');
    expect(agents).toHaveLength(1);
    expect(agents[0]?.description).toBe('From claude');
  });

  it('filters by name or description query', async () => {
    const provider = new DshAgentMentionProvider(createStorage({
      '.claude/agents/alpha.md': [
        '---',
        'name: alpha',
        'description: Handles security reviews',
        '---',
        'x',
      ].join('\n'),
      '.claude/agents/beta.md': [
        '---',
        'name: beta',
        'description: Handles documentation',
        '---',
        'x',
      ].join('\n'),
    }));
    await provider.ensureLoaded();

    expect(provider.searchAgents('security')).toHaveLength(1);
    expect(provider.searchAgents('alpha')).toHaveLength(1);
    expect(provider.searchAgents('missing')).toHaveLength(0);
  });

  it('lazy-loads on ensureLoaded and caches', async () => {
    const provider = new DshAgentMentionProvider(createStorage({
      '.claude/agents/one.md': [
        '---',
        'name: one',
        'description: One',
        '---',
        'x',
      ].join('\n'),
    }));

    expect(provider.isLoaded()).toBe(false);
    await provider.ensureLoaded();
    expect(provider.isLoaded()).toBe(true);
    expect(provider.searchAgents('')).toHaveLength(1);
  });
});
