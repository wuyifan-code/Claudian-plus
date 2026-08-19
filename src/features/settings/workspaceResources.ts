import type { ProviderCommandEntry } from '../../core/providers/commands/ProviderCommandEntry';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from '../../core/providers/types';
import type { AgentSkillListResult } from '../../core/skills/AgentSkill';

export type WorkspaceResourceSection = 'skills' | 'agents' | 'mcp' | 'commands' | 'memory' | 'consciousness';

/** Row key prefix identifying shared .agents/skills rows loaded via loadSharedSkills. */
export const SHARED_SKILL_ROW_KEY_PREFIX = 'shared-agent-skill:';

export type WorkspaceResourceStatus = 'available' | 'connected' | 'disabled' | 'readonly';

export interface WorkspaceResourceRow {
  key: string;
  name: string;
  description?: string;
  providerIds: ProviderId[];
  source: string;
  status: WorkspaceResourceStatus;
}

/**
 * Case-insensitive substring match across name, description, and source path.
 * A blank query returns every row.
 */
export function filterWorkspaceResourceRows(
  rows: readonly WorkspaceResourceRow[],
  query: string,
): WorkspaceResourceRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(row => (
    row.name.toLowerCase().includes(needle)
    || row.source.toLowerCase().includes(needle)
    || (row.description?.toLowerCase().includes(needle) ?? false)
  ));
}

export interface WorkspaceResourceLoadOptions {
  loadSharedSkills?: () => Promise<AgentSkillListResult>;
}

function fallbackCommandSource(entry: ProviderCommandEntry): string {
  if (entry.scope === 'runtime' || entry.source === 'sdk' || entry.source === 'builtin') {
    return 'Provider runtime';
  }
  if (entry.providerId === 'claude') {
    return entry.kind === 'skill'
      ? `.claude/skills/${entry.name}/SKILL.md`
      : `.claude/commands/${entry.name}.md`;
  }
  return 'Provider native storage';
}

function mergeRows(rows: WorkspaceResourceRow[], providerOrder: readonly ProviderId[]): WorkspaceResourceRow[] {
  const merged = new Map<string, WorkspaceResourceRow>();
  for (const row of rows) {
    const mergeKey = `${row.name.toLowerCase()}\u0000${row.source}`;
    const existing = merged.get(mergeKey);
    if (!existing) {
      merged.set(mergeKey, { ...row, providerIds: [...row.providerIds] });
      continue;
    }
    for (const providerId of row.providerIds) {
      if (!existing.providerIds.includes(providerId)) {
        existing.providerIds.push(providerId);
      }
    }
  }

  const order = new Map(providerOrder.map((providerId, index) => [providerId, index]));
  return [...merged.values()]
    .map(row => ({
      ...row,
      providerIds: row.providerIds.sort((left, right) => (
        (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER)
      )),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function loadCommandResources(
  providerIds: readonly ProviderId[],
  section: 'skills' | 'commands',
): Promise<WorkspaceResourceRow[]> {
  const rows = await Promise.all(providerIds.map(async (providerId) => {
    const catalog = ProviderWorkspaceRegistry.getCommandCatalog(providerId);
    if (!catalog) return [];
    try {
      const entries = await catalog.listVaultEntries();
      return entries
        .filter(entry => entry.kind === (section === 'skills' ? 'skill' : 'command'))
        .map((entry): WorkspaceResourceRow => ({
          key: `${providerId}:${entry.id}`,
          name: entry.name,
          description: entry.description,
          providerIds: [providerId],
          source: fallbackCommandSource(entry),
          status: entry.isEditable ? 'available' : 'readonly',
        }));
    } catch {
      return [];
    }
  }));
  return rows.flat();
}

async function loadSharedSkillResources(
  providerIds: readonly ProviderId[],
  loadSharedSkills: WorkspaceResourceLoadOptions['loadSharedSkills'],
): Promise<WorkspaceResourceRow[]> {
  if (!loadSharedSkills) return [];

  const supportedProviderIds = providerIds.filter(providerId => (
    ProviderRegistry.getCapabilities(providerId).supportsSharedAgentSkills === true
  ));
  if (supportedProviderIds.length === 0) return [];

  try {
    const { skills } = await loadSharedSkills();
    return skills.map(skill => ({
      key: `${SHARED_SKILL_ROW_KEY_PREFIX}${skill.name}`,
      name: skill.name,
      description: skill.description,
      providerIds: [...supportedProviderIds],
      source: skill.filePath,
      status: 'available',
    }));
  } catch {
    return [];
  }
}

async function loadAgentResources(providerIds: readonly ProviderId[]): Promise<WorkspaceResourceRow[]> {
  const rows = await Promise.all(providerIds.map(async (providerId) => {
    const provider = ProviderWorkspaceRegistry.getAgentMentionProvider(providerId);
    if (!provider) return [];
    await provider.ensureLoaded?.();
    return provider.searchAgents('').map((agent): WorkspaceResourceRow => ({
      key: `${providerId}:${agent.id}`,
      name: agent.name,
      description: agent.description,
      providerIds: [providerId],
      source: agent.source === 'global' ? 'Home agents' : `${providerId} vault agents`,
      status: agent.source === 'vault' ? 'available' : 'readonly',
    }));
  }));
  return rows.flat();
}

async function loadMcpResources(providerIds: readonly ProviderId[]): Promise<WorkspaceResourceRow[]> {
  const rows = await Promise.all(providerIds.map(async (providerId) => {
    const manager = ProviderWorkspaceRegistry.getMcpServerManager(providerId);
    if (!manager) return [];
    await manager.ensureLoaded?.();
    const source = `${providerId} MCP configuration`;
    return manager.getServers().map((server): WorkspaceResourceRow => ({
      key: `${providerId}:${server.name}`,
      name: server.name,
      providerIds: [providerId],
      source,
      status: server.enabled ? 'connected' : 'disabled',
    }));
  }));
  return rows.flat();
}

export async function loadWorkspaceResources(
  providerIds: readonly ProviderId[],
  section: WorkspaceResourceSection,
  options: WorkspaceResourceLoadOptions = {},
): Promise<WorkspaceResourceRow[]> {
  const rows = section === 'skills'
    ? [
      ...await loadCommandResources(providerIds, section),
      ...await loadSharedSkillResources(providerIds, options.loadSharedSkills),
    ]
    : section === 'commands'
      ? await loadCommandResources(providerIds, section)
      : section === 'agents'
        ? await loadAgentResources(providerIds)
        : await loadMcpResources(providerIds);
  return mergeRows(rows, providerIds);
}
