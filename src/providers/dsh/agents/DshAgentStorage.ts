import { parse as parseToml } from 'smol-toml';

import { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { parseFrontmatter } from '../../../utils/frontmatter';

export const CLAUDE_VAULT_AGENTS_PATH = '.claude/agents';
export const CODEX_VAULT_AGENTS_PATH = '.codex/agents';
export const CLAUDE_HOME_AGENTS_PATH = '.claude/agents';
export const CODEX_HOME_AGENTS_PATH = '.codex/agents';

export type DshAgentOrigin = 'home' | 'vault';

export interface DshVaultAgent {
  description: string;
  filePath: string;
  id: string;
  name: string;
  origin: DshAgentOrigin;
}

/**
 * Discovers agent definitions the DSH model can follow when mentioned:
 * `.claude/agents/*.md` (Claude-style frontmatter agents) and
 * `.codex/agents/*.toml` (Codex-style subagents) in the vault AND the user
 * home (`~/.claude/agents`, `~/.codex/agents` — DSH loads both). The mention
 * only carries name/description; DSH models resolve the agent file through
 * their own tools.
 */
export class DshAgentStorage {
  constructor(
    private readonly adapter: VaultFileAdapter,
    private readonly homeAdapter: HomeFileAdapter = new HomeFileAdapter(),
  ) {}

  async loadAll(): Promise<DshVaultAgent[]> {
    const agents: DshVaultAgent[] = [];
    const seen = new Set<string>();

    const addAgents = (scanned: DshVaultAgent[]) => {
      for (const agent of scanned) {
        if (!seen.has(agent.id)) {
          seen.add(agent.id);
          agents.push(agent);
        }
      }
    };

    addAgents(await this.scanClaudeAgents(this.adapter, 'vault'));
    addAgents(await this.scanCodexAgents(this.adapter, 'vault'));
    addAgents(await this.scanClaudeAgents(this.homeAdapter, 'home'));
    addAgents(await this.scanCodexAgents(this.homeAdapter, 'home'));

    return agents.sort((left, right) => left.name.localeCompare(right.name));
  }

  private async scanClaudeAgents(
    adapter: Pick<VaultFileAdapter, 'listFiles' | 'read'>,
    origin: DshAgentOrigin,
  ): Promise<DshVaultAgent[]> {
    const results: DshVaultAgent[] = [];
    let files: string[];
    try {
      files = await adapter.listFiles(origin === 'vault' ? CLAUDE_VAULT_AGENTS_PATH : CLAUDE_HOME_AGENTS_PATH);
    } catch {
      return results;
    }

    for (const filePath of files) {
      if (!filePath.endsWith('.md')) {
        continue;
      }
      try {
        const content = await adapter.read(filePath);
        const parsed = parseFrontmatter(content);
        const name = parsed?.frontmatter?.name;
        const description = parsed?.frontmatter?.description;
        if (typeof name !== 'string' || !name.trim() || typeof description !== 'string' || !description.trim()) {
          continue;
        }
        results.push({
          description: description.trim(),
          filePath,
          id: name.trim(),
          name: name.trim(),
          origin,
        });
      } catch {
        // Skip unreadable agent files.
      }
    }

    return results;
  }

  private async scanCodexAgents(
    adapter: Pick<VaultFileAdapter, 'listFiles' | 'read'>,
    origin: DshAgentOrigin,
  ): Promise<DshVaultAgent[]> {
    const results: DshVaultAgent[] = [];
    let files: string[];
    try {
      files = await adapter.listFiles(origin === 'vault' ? CODEX_VAULT_AGENTS_PATH : CODEX_HOME_AGENTS_PATH);
    } catch {
      return results;
    }

    for (const filePath of files) {
      if (!filePath.endsWith('.toml')) {
        continue;
      }
      try {
        const content = await adapter.read(filePath);
        const parsed = parseToml(content) as Record<string, unknown>;
        const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
        const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
        if (!name || !description) {
          continue;
        }
        results.push({
          description,
          filePath,
          id: name,
          name,
          origin,
        });
      } catch {
        // Skip malformed TOML agent files.
      }
    }

    return results;
  }
}
