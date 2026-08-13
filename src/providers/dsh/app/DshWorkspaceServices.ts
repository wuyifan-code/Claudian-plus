import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderModelCatalogRefreshResult,
  ProviderWorkspaceInitContext,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import { DshAgentMentionProvider } from '../agents/DshAgentMentionProvider';
import { DshAgentStorage } from '../agents/DshAgentStorage';
import { DshCommandCatalog } from '../commands/DshCommandCatalog';
import { DshCliResolver } from '../runtime/DshCliResolver';
import { dshSettingsTabRenderer } from '../ui/DshSettingsTab';
import { DshMcpServerManager } from './DshMcpServerManager';
import { DshModelDiscoveryService } from './DshModelDiscoveryService';

export async function createDshWorkspaceServices(
  context: ProviderWorkspaceInitContext,
): Promise<ProviderWorkspaceServices> {
  const discoveryService = new DshModelDiscoveryService(context.plugin);
  const homeAdapter = new HomeFileAdapter();
  const agentStorage = new DshAgentStorage(context.vaultAdapter, homeAdapter);
  const agentMentionProvider = new DshAgentMentionProvider(agentStorage);
  return {
    agentMentionProvider,
    cliResolver: new DshCliResolver(),
    commandCatalog: new DshCommandCatalog(context.vaultAdapter),
    mcpServerManager: new DshMcpServerManager(context.vaultAdapter),
    prepareSettings: async () => {
      await agentMentionProvider.ensureLoaded();
      // Populate discoveredModels at workspace init so the chat UI shows the
      // profile's context windows without waiting for the settings picker.
      await discoveryService.refreshModelCatalog();
    },
    refreshAgentMentions: async () => {
      await agentMentionProvider.ensureLoaded();
    },
    refreshModelCatalog: async (): Promise<ProviderModelCatalogRefreshResult> => (
      discoveryService.refreshModelCatalog()
    ),
    settingsTabRenderer: dshSettingsTabRenderer,
  };
}

export const dshWorkspaceRegistration: ProviderWorkspaceRegistration<ProviderWorkspaceServices> = {
  initialize: async (context) => createDshWorkspaceServices(context),
};

export function maybeGetDshWorkspaceServices(): ProviderWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('dsh');
}
