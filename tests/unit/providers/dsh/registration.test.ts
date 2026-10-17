import '@/providers';

import { decodeProviderModelSelectionId } from '@/core/providers/modelSelection';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { DshInstructionRefineService } from '@/providers/dsh/auxiliary/DshInstructionRefineService';
import { DshTitleGenerationService } from '@/providers/dsh/auxiliary/DshTitleGenerationService';
import { dshProviderCapabilities } from '@/providers/dsh/capabilities';
import { DshHistoryService } from '@/providers/dsh/history/DshHistoryService';
import { DSH_DEFAULT_MODEL_ID, encodeDshModelId } from '@/providers/dsh/models';
import { dshProviderRegistration } from '@/providers/dsh/registration';
import { getDshProviderSettings } from '@/providers/dsh/settings';
import { BUILT_IN_PROVIDER_MODULES, registerBuiltInProviders } from '@/providers/index';

jest.mock('@/providers/dsh/app/DshWorkspaceServices', () => ({
  dshWorkspaceRegistration: { initialize: jest.fn() },
  getDshWorkspaceServices: () => ({ dshHost: {} }),
}));

describe('independent DSH provider registration', () => {
  it('registers the disabled-by-default provider without claiming other providers models', () => {
    registerBuiltInProviders();
    expect(BUILT_IN_PROVIDER_MODULES).toContain(dshProviderRegistration);
    expect(ProviderRegistry.getRegisteredProviderIds()).toContain('dsh');
    expect(ProviderRegistry.getCapabilities('dsh')).toBe(dshProviderCapabilities);
    expect(dshProviderRegistration.isEnabled({})).toBe(false);
    const settings: Record<string, unknown> = {};
    dshProviderRegistration.setEnabled?.(settings, true);
    expect(getDshProviderSettings(settings).enabled).toBe(true);
    expect(ProviderRegistry.resolveProviderForModel(DSH_DEFAULT_MODEL_ID, settings)).toBe('dsh');
    expect(ProviderRegistry.resolveProviderForModel(encodeDshModelId('deepseek', 'deepseek-v4-pro'), settings)).toBe('dsh');
    expect(decodeProviderModelSelectionId('dsh/deepseek/deepseek-v4-pro')?.providerId).toBe('dsh');
    expect(dshProviderRegistration.chatUIConfig.ownsModel('deepseek-v4-pro', settings)).toBe(false);
    expect(ProviderRegistry.getEnabledProviderIds({})).not.toContain('dsh');
  });

  it('creates the native runtime and model-free auxiliary services', () => {
    const plugin = { settings: {}, app: { vault: { adapter: { basePath: '/vault' } } } } as unknown as ProviderHost;
    const runtime = dshProviderRegistration.createRuntime({ plugin });
    expect(runtime.providerId).toBe('dsh');
    runtime.cleanup();
    expect(dshProviderRegistration.historyService).toBeInstanceOf(DshHistoryService);
    expect(dshProviderRegistration.createTitleGenerationService(plugin)).toBeInstanceOf(DshTitleGenerationService);
    expect(dshProviderRegistration.createInstructionRefineService(plugin)).toBeInstanceOf(DshInstructionRefineService);
    expect(dshProviderRegistration.createAuxQueryRunner).toBeUndefined();
    expect(dshProviderRegistration.subagentLifecycleAdapter).toBeUndefined();
  });

  it('merges provider settings without clobbering other native configuration', () => {
    const target: Record<string, unknown> = { providerConfigs: { dsh: { future: 'keep' }, codex: { enabled: true } } };
    expect(dshProviderRegistration.settingsStorage.normalizeStored(target, { providerConfigs: { dsh: { enabled: true, cliPath: '/dsh' } } })).toBe(false);
    expect(target.providerConfigs).toMatchObject({ dsh: { enabled: true, cliPath: '/dsh', future: 'keep' }, codex: { enabled: true } });
    expect(dshProviderRegistration.environmentKeyPatterns?.some(pattern => pattern.test('DSH_HOME'))).toBe(true);
  });
});
