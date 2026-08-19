import type { SlashCommand } from '../../types';
import type { ProviderCommandCatalog, ProviderCommandDropdownConfig } from './ProviderCommandCatalog';
import type { ProviderCommandEntry } from './ProviderCommandEntry';

export interface RuntimeOnlyCommandCatalogConfig {
  providerId: string;
  /** Name used in the not-editable/not-deletable error messages. */
  displayName: string;
  /** Preserve an existing command kind instead of defaulting to 'command'. */
  preserveCommandKind?: boolean;
}

function dedupeRuntimeCommands(commands: SlashCommand[]): SlashCommand[] {
  const deduped: SlashCommand[] = [];
  const seen = new Set<string>();

  for (const command of commands) {
    const normalizedName = command.name.trim().replace(/^\/+/, '');
    if (!normalizedName) {
      continue;
    }

    const key = normalizedName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      ...command,
      name: normalizedName,
    });
  }

  return deduped;
}

/**
 * Builds a ProviderCommandCatalog for providers whose runtime commands are
 * read-only (not editable or deletable from Claudian Plus).
 */
export function createRuntimeOnlyCommandCatalogClass(
  config: RuntimeOnlyCommandCatalogConfig,
): new () => ProviderCommandCatalog {
  const { providerId, displayName, preserveCommandKind } = config;

  const slashCommandToEntry = (command: SlashCommand): ProviderCommandEntry => ({
    id: command.id,
    providerId,
    kind: preserveCommandKind ? command.kind ?? 'command' : 'command',
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
    scope: 'runtime',
    source: command.source ?? 'sdk',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  });

  return class implements ProviderCommandCatalog {
    private runtimeCommands: SlashCommand[] = [];

    setRuntimeCommands(commands: SlashCommand[]): void {
      this.runtimeCommands = dedupeRuntimeCommands(commands);
    }

    async listDropdownEntries(_context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
      return this.runtimeCommands.map(slashCommandToEntry);
    }

    async listVaultEntries(): Promise<ProviderCommandEntry[]> {
      return [];
    }

    async saveVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
      throw new Error(`${displayName} runtime commands are not editable from Claudian Plus.`);
    }

    async deleteVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
      throw new Error(`${displayName} runtime commands are not deletable from Claudian Plus.`);
    }

    getDropdownConfig(): ProviderCommandDropdownConfig {
      return {
        providerId,
        triggerChars: ['/'],
        builtInPrefix: '/',
        skillPrefix: '/',
        commandPrefix: '/',
      };
    }

    async refresh(): Promise<void> {}
  };
}
