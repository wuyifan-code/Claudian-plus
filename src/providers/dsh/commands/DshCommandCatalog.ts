import type {
  ProviderCommandCatalog,
  ProviderCommandDropdownConfig,
} from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { SlashCommand } from '../../../core/types';
import { parseFrontmatter } from '../../../utils/frontmatter';
import {
  parsedToSlashCommand,
  parseSlashCommandContent,
} from '../../../utils/slashCommand';
import { resolveDshHome } from '../app/DshModelDiscoveryService';

const SKILL_ROOTS = [
  '.claude/skills',
  '.codex/skills',
  '.agents/skills',
] as const;

const COMMANDS_ROOT = '.claude/commands';

export interface DshSkillRootSpec {
  adapter: Pick<VaultFileAdapter, 'listFolders' | 'read'>;
  root: string;
}

export interface DshCommandCatalogOptions {
  /** Home-level skill roots; defaults to the DSH skill-filesystem's user roots. */
  homeSkillRoots?: DshSkillRootSpec[];
}

/** Home-level skill roots the DSH skill-filesystem mounts by default. */
function defaultHomeSkillRoots(): DshSkillRootSpec[] {
  return [
    { adapter: new HomeFileAdapter(), root: '.agents/skills' },
    { adapter: new HomeFileAdapter(resolveDshHome()), root: 'skills' },
  ];
}

type SkillScanAdapter = Pick<VaultFileAdapter, 'listFolders' | 'read'>;

/**
 * DSH vault catalog: the SKILL.md roots DSH's skill-filesystem understands
 * (project `.claude/.codex/.agents` skills + home `~/.agents/skills` and
 * `$DSH_HOME/skills`) plus Claude-style slash commands. Entries are read-only
 * from Claudian Plus — the files are shared with other providers' tooling.
 */
export class DshCommandCatalog implements ProviderCommandCatalog {
  private readonly homeSkillRoots: DshSkillRootSpec[];

  constructor(
    private readonly adapter: VaultFileAdapter,
    options: DshCommandCatalogOptions = {},
  ) {
    this.homeSkillRoots = options.homeSkillRoots ?? defaultHomeSkillRoots();
  }

  setRuntimeCommands(_commands: SlashCommand[]): void {
    // DSH ACP exposes no runtime commands.
  }

  async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    return this.listVaultEntries();
  }

  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    const entries: ProviderCommandEntry[] = [];
    const seenNames = new Set<string>();

    for (const root of SKILL_ROOTS) {
      for (const skill of await scanSkillRoot(this.adapter, root)) {
        pushSkill(entries, seenNames, skill, 'vault');
      }
    }
    for (const { adapter, root } of this.homeSkillRoots) {
      for (const skill of await scanSkillRoot(adapter, root)) {
        pushSkill(entries, seenNames, skill, 'user');
      }
    }

    for (const command of await this.scanCommands()) {
      entries.push(toVaultEntry(command, 'vault'));
    }

    return entries.sort((left, right) => left.name.localeCompare(right.name));
  }

  async saveVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
    throw new Error('DSH vault skills and commands are read-only from Claudian Plus.');
  }

  async deleteVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
    throw new Error('DSH vault skills and commands are read-only from Claudian Plus.');
  }

  getDropdownConfig(): ProviderCommandDropdownConfig {
    return {
      builtInPrefix: '/',
      commandPrefix: '/',
      providerId: 'dsh',
      skillPrefix: '/',
      triggerChars: ['/'],
    };
  }

  async refresh(): Promise<void> {
    // Vault files are re-read on every list call.
  }

  private async scanCommands(): Promise<SlashCommand[]> {
    let files: string[];
    try {
      files = await this.adapter.listFilesRecursive(COMMANDS_ROOT);
    } catch {
      return [];
    }

    const commands: SlashCommand[] = [];
    for (const filePath of files) {
      if (!filePath.endsWith('.md')) {
        continue;
      }
      try {
        const content = await this.adapter.read(filePath);
        const name = filePath
          .slice(COMMANDS_ROOT.length + 1)
          .replace(/\.md$/, '')
          .split('/')
          .pop()!;
        commands.push({
          ...parsedToSlashCommand(parseSlashCommandContent(content), {
            id: `dsh-cmd-${name}`,
            name,
            source: 'user',
          }),
          kind: 'command',
        });
      } catch {
        // Skip unreadable command files.
      }
    }

    return commands;
  }
}

interface ScannedDshSkill {
  description?: string;
  name: string;
  promptContent: string;
}

/**
 * Scans one skill root for `<name>/SKILL.md` files. The DSH skill-filesystem
 * resolves a skill by its frontmatter `name`, so versioned home folders
 * (e.g. `blog-writer-0.1.0`) surface as their declared name; the folder name
 * is only the fallback.
 */
async function scanSkillRoot(
  adapter: SkillScanAdapter,
  root: string,
): Promise<ScannedDshSkill[]> {
  let folders: string[];
  try {
    folders = await adapter.listFolders(root);
  } catch {
    return [];
  }

  const skills: ScannedDshSkill[] = [];
  for (const folder of folders) {
    const folderName = folder.split('/').pop()!;
    const skillPath = `${root}/${folderName}/SKILL.md`;
    let raw: string;
    try {
      raw = await adapter.read(skillPath);
    } catch {
      // Skip malformed or unreadable files.
      continue;
    }
    const frontmatter = parseFrontmatter(raw);
    const declaredName = frontmatter?.frontmatter?.name;
    const name = typeof declaredName === 'string' && declaredName.trim()
      ? declaredName.trim()
      : folderName;
    const parsed = parseSlashCommandContent(raw);
    skills.push({
      description: parsed.description,
      name,
      promptContent: parsed.promptContent,
    });
  }
  return skills;
}

function pushSkill(
  target: ProviderCommandEntry[],
  seenNames: Set<string>,
  skill: ScannedDshSkill,
  scope: ProviderCommandEntry['scope'],
): void {
  if (seenNames.has(skill.name)) {
    return;
  }
  seenNames.add(skill.name);
  const command = parsedToSlashCommand(
    {
      description: skill.description,
      promptContent: skill.promptContent,
    },
    {
      id: `dsh-skill-${skill.name}`,
      name: skill.name,
      source: 'user',
    },
  );
  target.push(toVaultEntry({ ...command, kind: 'skill' }, scope));
}

function toVaultEntry(
  command: SlashCommand,
  scope: ProviderCommandEntry['scope'],
): ProviderCommandEntry {
  return {
    id: command.id,
    providerId: 'dsh',
    kind: command.kind === 'skill' ? 'skill' : 'command',
    name: command.name,
    description: command.description,
    content: command.content,
    argumentHint: command.argumentHint,
    allowedTools: command.allowedTools,
    model: command.model,
    disableModelInvocation: command.disableModelInvocation,
    userInvocable: command.userInvocable,
    context: command.context,
    agent: command.agent,
    hooks: command.hooks,
    scope,
    source: 'user',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  };
}
