import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { AntigravityCliResolver } from '../runtime/AntigravityCliResolver';
import { ANTIGRAVITY_PROVIDER_ID } from '../runtime/AntigravityLaunchSpec';
import { antigravitySettingsTabRenderer } from '../ui/AntigravitySettingsTab';

export type AntigravityWorkspaceServices = ProviderWorkspaceServices;

/**
 * Antigravity exposes exactly two workspace services. Everything else the
 * shared registry can carry is deliberately absent rather than stubbed:
 * no command catalog or runtime command loader (the provider advertises no
 * slash commands), no agent mention provider, no MCP server manager, no model
 * catalog refresh (there is no verified discovery), and no tab warmup policy —
 * warming a tab would launch `agy`, whose process startup costs seconds and
 * may consume account usage before the user ever sends a turn.
 */
export async function createAntigravityWorkspaceServices(): Promise<AntigravityWorkspaceServices> {
  return {
    cliResolver: new AntigravityCliResolver(),
    settingsTabRenderer: antigravitySettingsTabRenderer,
  };
}

export const antigravityWorkspaceRegistration: ProviderWorkspaceRegistration<AntigravityWorkspaceServices> = {
  initialize: async () => createAntigravityWorkspaceServices(),
};

export function maybeGetAntigravityWorkspaceServices(): AntigravityWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices(ANTIGRAVITY_PROVIDER_ID);
}
