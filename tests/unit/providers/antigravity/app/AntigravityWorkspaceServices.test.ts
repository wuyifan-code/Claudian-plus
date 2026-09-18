import * as childProcess from 'node:child_process';

import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import {
  antigravityWorkspaceRegistration,
  createAntigravityWorkspaceServices,
  maybeGetAntigravityWorkspaceServices,
} from '@/providers/antigravity/app/AntigravityWorkspaceServices';
import { AntigravityCliResolver } from '@/providers/antigravity/runtime/AntigravityCliResolver';
import { antigravitySettingsTabRenderer } from '@/providers/antigravity/ui/AntigravitySettingsTab';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn(),
  exec: jest.fn(),
  execSync: jest.fn(),
  execFile: jest.fn(),
  execFileSync: jest.fn(),
}));

const spawnSpies = [
  childProcess.spawn,
  childProcess.spawnSync,
  childProcess.exec,
  childProcess.execSync,
  childProcess.execFile,
  childProcess.execFileSync,
] as unknown as jest.Mock[];

describe('AntigravityWorkspaceServices', () => {
  afterEach(() => {
    ProviderWorkspaceRegistry.clear();
    jest.clearAllMocks();
  });

  it('initializes exactly the CLI resolver and the settings tab renderer', async () => {
    const services = await createAntigravityWorkspaceServices();

    expect(services.cliResolver).toBeInstanceOf(AntigravityCliResolver);
    expect(services.settingsTabRenderer).toBe(antigravitySettingsTabRenderer);
    expect(Object.keys(services).sort()).toEqual(['cliResolver', 'settingsTabRenderer']);
  });

  it('omits the workspace services the provider cannot honestly serve', async () => {
    const services = await createAntigravityWorkspaceServices();

    // Commands, agent mentions, MCP, model discovery, and a tab warmup policy
    // are all unsupported: each would either expose a feature the provider has
    // no capability for, or launch `agy` without a user turn.
    for (const unsupported of [
      'agentMentionProvider',
      'commandCatalog',
      'mcpServerManager',
      'prepareSettings',
      'refreshAgentMentions',
      'refreshModelCatalog',
      'runtimeCommandLoader',
      'tabWarmupPolicy',
    ]) {
      expect(unsupported in services).toBe(false);
    }
  });

  it('reports no capability-backed entry point through the workspace registry', async () => {
    ProviderWorkspaceRegistry.setServices('antigravity', await createAntigravityWorkspaceServices());

    expect(ProviderWorkspaceRegistry.getCliResolver('antigravity')).toBeInstanceOf(AntigravityCliResolver);
    expect(ProviderWorkspaceRegistry.getSettingsTabRenderer('antigravity')).toBe(antigravitySettingsTabRenderer);
    expect(ProviderWorkspaceRegistry.getCommandCatalog('antigravity')).toBeNull();
    expect(ProviderWorkspaceRegistry.getAgentMentionProvider('antigravity')).toBeNull();
    expect(ProviderWorkspaceRegistry.getRuntimeCommandLoader('antigravity')).toBeNull();
    expect(ProviderWorkspaceRegistry.getMcpServerManager('antigravity')).toBeNull();
    // A null warmup policy resolves to 'none', so opening a tab never launches the CLI.
    expect(ProviderWorkspaceRegistry.getTabWarmupPolicy('antigravity')).toBeNull();
  });

  it('returns null until the workspace services are initialized', async () => {
    expect(maybeGetAntigravityWorkspaceServices()).toBeNull();

    const services = await createAntigravityWorkspaceServices();
    ProviderWorkspaceRegistry.setServices('antigravity', services);

    expect(maybeGetAntigravityWorkspaceServices()).toBe(services);
  });

  it('registers a workspace entry point that builds the same services', async () => {
    const services = await antigravityWorkspaceRegistration.initialize({} as never);

    expect(services.cliResolver).toBeInstanceOf(AntigravityCliResolver);
    expect(services.settingsTabRenderer).toBe(antigravitySettingsTabRenderer);
  });

  it('never launches the CLI while initializing its services', async () => {
    await createAntigravityWorkspaceServices();

    for (const spawnSpy of spawnSpies) {
      expect(spawnSpy).not.toHaveBeenCalled();
    }
  });
});
