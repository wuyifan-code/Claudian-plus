import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';

function createSettings(): Record<string, unknown> {
  return { providerConfigs: {} };
}

describe('Antigravity provider enablement', () => {
  it('starts disabled and is not offered as a default chat provider', () => {
    const settings = createSettings();

    expect(ProviderRegistry.isEnabled('antigravity', settings)).toBe(false);
    expect(ProviderRegistry.getEnabledProviderIds(settings)).not.toContain('antigravity');
  });

  it('applies enablement through the coordinator boundary', () => {
    const settings = createSettings();

    expect(ProviderSettingsCoordinator.applyProviderEnablement(settings, 'antigravity', true)).toBe('applied');
    expect(ProviderRegistry.isEnabled('antigravity', settings)).toBe(true);
    expect(ProviderRegistry.getEnabledProviderIds(settings)).toContain('antigravity');

    expect(ProviderSettingsCoordinator.applyProviderEnablement(settings, 'antigravity', false)).toBe('applied');
    expect(ProviderRegistry.isEnabled('antigravity', settings)).toBe(false);
  });

  it('preserves unrelated provider configuration while toggling enablement', () => {
    const settings = createSettings();
    settings.providerConfigs = {
      codex: { enabled: true, model: 'gpt-5.6-sol' },
    };

    ProviderSettingsCoordinator.applyProviderEnablement(settings, 'antigravity', true);

    expect(settings.providerConfigs).toMatchObject({
      codex: { enabled: true, model: 'gpt-5.6-sol' },
    });
  });
});
