import type { ProviderCommandCatalog } from '@/core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from '@/core/providers/types';
import type { AgentSkillListResult } from '@/core/skills/AgentSkill';
import {
  filterWorkspaceResourceRows,
  loadWorkspaceResources,
  type WorkspaceResourceRow,
} from '@/features/settings/workspaceResources';

function makeEntry(
  providerId: ProviderId,
  name: string,
  kind: 'command' | 'skill',
  overrides: Partial<ProviderCommandEntry> = {},
): ProviderCommandEntry {
  return {
    id: providerId + '-' + kind + '-' + name,
    providerId,
    kind,
    name,
    description: name + ' description',
    content: name + ' content',
    scope: 'vault',
    source: 'user',
    isEditable: true,
    isDeletable: true,
    displayPrefix: '/',
    insertPrefix: '/',
    ...overrides,
  };
}

function makeCatalog(entries: ProviderCommandEntry[]): ProviderCommandCatalog {
  return {
    listDropdownEntries: jest.fn().mockResolvedValue(entries),
    listVaultEntries: jest.fn().mockResolvedValue(entries),
    saveVaultEntry: jest.fn().mockResolvedValue(undefined),
    deleteVaultEntry: jest.fn().mockResolvedValue(undefined),
    setRuntimeCommands: jest.fn(),
    getDropdownConfig: jest.fn().mockReturnValue({
      triggerChars: ['/'],
      builtInPrefix: '/',
      skillPrefix: '$',
      commandPrefix: '/',
    }),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
}

function makeSharedSkills(): AgentSkillListResult {
  return {
    skills: [
      {
        name: 'shared-skill',
        description: 'shared skill description',
        instructions: 'do things',
        frontmatter: {},
        directoryPath: '.agents/skills/shared-skill',
        filePath: '.agents/skills/shared-skill/SKILL.md',
        revision: 'rev-1',
        scope: 'vault',
      },
    ],
    diagnostics: [],
  };
}

function makeRow(name: string, overrides: Partial<WorkspaceResourceRow> = {}): WorkspaceResourceRow {
  return {
    key: 'test:' + name,
    name,
    providerIds: ['codex'],
    source: '.codex/skills/' + name + '/SKILL.md',
    status: 'available',
    ...overrides,
  };
}

afterEach(() => {
  ProviderWorkspaceRegistry.clear();
});

describe('loadWorkspaceResources', () => {
  it('loads provider skills with descriptions and shared skills for supporting providers', async () => {
    ProviderWorkspaceRegistry.setServices('codex', {
      commandCatalog: makeCatalog([
        makeEntry('codex', 'codex-skill', 'skill'),
        makeEntry('codex', 'codex-command', 'command'),
      ]),
    });

    const rows = await loadWorkspaceResources(['codex'], 'skills', {
      loadSharedSkills: jest.fn().mockResolvedValue(makeSharedSkills()),
    });

    const catalogRow = rows.find(row => row.name === 'codex-skill');
    expect(catalogRow).toBeDefined();
    expect(catalogRow?.description).toBe('codex-skill description');
    expect(catalogRow?.status).toBe('available');
    expect(rows.some(row => row.name === 'codex-command')).toBe(false);

    const sharedRow = rows.find(row => row.name === 'shared-skill');
    expect(sharedRow).toBeDefined();
    expect(sharedRow?.description).toBe('shared skill description');
    expect(sharedRow?.source).toBe('.agents/skills/shared-skill/SKILL.md');
    expect(sharedRow?.providerIds).toEqual(['codex']);
  });

  it('marks non-editable catalog commands as readonly', async () => {
    ProviderWorkspaceRegistry.setServices('codex', {
      commandCatalog: makeCatalog([
        makeEntry('codex', 'ro-command', 'command', { isEditable: false, source: 'sdk' }),
      ]),
    });

    const rows = await loadWorkspaceResources(['codex'], 'commands');

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('readonly');
    expect(rows[0].source).toBe('Provider runtime');
  });

  it('loads agent rows with description and readonly status for global agents', async () => {
    ProviderWorkspaceRegistry.setServices('codex', {
      agentMentionProvider: {
        searchAgents: jest.fn().mockReturnValue([
          { id: 'a1', name: 'vault-agent', description: 'helps', source: 'vault' },
          { id: 'a2', name: 'global-agent', source: 'global' },
        ]),
      },
    });

    const rows = await loadWorkspaceResources(['codex'], 'agents');

    expect(rows).toHaveLength(2);
    const vaultAgent = rows.find(row => row.name === 'vault-agent');
    expect(vaultAgent?.description).toBe('helps');
    expect(vaultAgent?.status).toBe('available');
    const globalAgent = rows.find(row => row.name === 'global-agent');
    expect(globalAgent?.status).toBe('readonly');
    expect(globalAgent?.source).toBe('Home agents');
  });

  it('maps MCP server enabled state to connected/disabled status', async () => {
    ProviderWorkspaceRegistry.setServices('codex', {
      mcpServerManager: {
        getServers: jest.fn().mockReturnValue([
          { name: 'on-server', enabled: true },
          { name: 'off-server', enabled: false },
        ]),
      } as never,
    });

    const rows = await loadWorkspaceResources(['codex'], 'mcp');

    expect(rows.find(row => row.name === 'on-server')?.status).toBe('connected');
    expect(rows.find(row => row.name === 'off-server')?.status).toBe('disabled');
  });

  it('merges rows with the same name and source across providers', async () => {
    ProviderWorkspaceRegistry.setServices('codex', {
      commandCatalog: makeCatalog([makeEntry('codex', 'dup', 'command', { source: 'user' })]),
    });
    ProviderWorkspaceRegistry.setServices('pi', {
      commandCatalog: makeCatalog([makeEntry('pi', 'dup', 'command', { source: 'user' })]),
    });

    const rows = await loadWorkspaceResources(['codex', 'pi'], 'commands');

    expect(rows).toHaveLength(1);
    expect(rows[0].providerIds).toEqual(['codex', 'pi']);
  });

  it('returns an empty list when providers have no workspace services', async () => {
    const rows = await loadWorkspaceResources(['codex'], 'mcp');
    expect(rows).toEqual([]);
  });
});

describe('filterWorkspaceResourceRows', () => {
  const rows = [
    makeRow('Alpha'),
    makeRow('beta', { source: '.claude/commands/beta.md' }),
    makeRow('gamma', { description: 'finds by description too' }),
  ];

  it('returns all rows for a blank query', () => {
    expect(filterWorkspaceResourceRows(rows, '')).toHaveLength(3);
    expect(filterWorkspaceResourceRows(rows, '   ')).toHaveLength(3);
  });

  it('matches by name case-insensitively', () => {
    const result = filterWorkspaceResourceRows(rows, 'ALPHA');
    expect(result.map(row => row.name)).toEqual(['Alpha']);
  });

  it('matches by source path', () => {
    const result = filterWorkspaceResourceRows(rows, 'commands/beta');
    expect(result.map(row => row.name)).toEqual(['beta']);
  });

  it('matches by description', () => {
    const result = filterWorkspaceResourceRows(rows, 'description too');
    expect(result.map(row => row.name)).toEqual(['gamma']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterWorkspaceResourceRows(rows, 'zzz')).toEqual([]);
  });
});
