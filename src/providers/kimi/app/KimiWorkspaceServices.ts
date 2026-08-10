import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { KimiCommandCatalog } from '../commands/KimiCommandCatalog';
import { KimiCliResolver } from '../runtime/KimiCliResolver';
import { kimiSettingsTabRenderer } from '../ui/KimiSettingsTab';

export interface KimiWorkspaceServices extends ProviderWorkspaceServices {
  commandCatalog: ProviderCommandCatalog;
}

export async function createKimiWorkspaceServices(): Promise<KimiWorkspaceServices> {
  return {
    commandCatalog: new KimiCommandCatalog(),
    cliResolver: new KimiCliResolver(),
    settingsTabRenderer: kimiSettingsTabRenderer,
  };
}

export const kimiWorkspaceRegistration: ProviderWorkspaceRegistration<KimiWorkspaceServices> = {
  initialize: async () => createKimiWorkspaceServices(),
};

export function maybeGetKimiWorkspaceServices(): KimiWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('kimi') as KimiWorkspaceServices | null;
}
