import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { ProviderSettingsTabRendererContext } from '@/core/providers/types';
import { getDshProviderSettings, updateDshProviderSettings } from '@/providers/dsh/settings';
import { dshSettingsTabRenderer } from '@/providers/dsh/ui/DshSettingsTab';

const mockSettings: Array<{ name: string; components: MockControl[] }> = [];
const mockRenderEnvironment = jest.fn();

class MockControl {
  value: unknown;
  disabled = false;
  change?: (value: string | boolean) => Promise<void> | void;
  click?: () => Promise<void> | void;
  setValue(value: unknown) { this.value = value; return this; }
  setPlaceholder(_value: string) { return this; }
  setButtonText(_value: string) { return this; }
  setDisabled(value: boolean) { this.disabled = value; return this; }
  onChange(callback: MockControl['change']) { this.change = callback; return this; }
  onClick(callback: MockControl['click']) { this.click = callback; return this; }
}

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  Setting: class {
    name = '';
    components: MockControl[] = [];
    constructor() { mockSettings.push(this); }
    setName(name: string) { this.name = name; return this; }
    setDesc(_description: string) { return this; }
    addText(callback: (control: MockControl) => void) { const control = new MockControl(); this.components.push(control); callback(control); return this; }
    addToggle(callback: (control: MockControl) => void) { return this.addText(callback); }
    addButton(callback: (control: MockControl) => void) { return this.addText(callback); }
  },
}));
jest.mock('@/shared/settings/EnvironmentSettingsSection', () => ({
  renderEnvironmentSettingsSection: (...args: unknown[]) => mockRenderEnvironment(...args),
}));
jest.mock('@/shared/settings/ProviderEnablementToggle', () => ({
  applyProviderEnablementToggle: jest.fn(async (context, _toggle, _providerId, enabled) => {
    context.plugin.settings.providerConfigs.dsh.enabled = enabled;
    return true;
  }),
}));

describe('DeepSeek Harness settings render', () => {
  beforeEach(() => {
    mockSettings.length = 0;
    jest.clearAllMocks();
  });

  function createContext(enabled: boolean) {
    const settings: Record<string, unknown> = {};
    updateDshProviderSettings(settings, { enabled });
    return {
      plugin: { settings, mutateSettings: jest.fn(async mutation => mutation(settings)), recycleProviderRuntimes: jest.fn() },
      refreshModelSelectors: jest.fn(), refreshTitleGenerationModelOptions: jest.fn(),
    } as unknown as ProviderSettingsTabRendererContext;
  }

  it('does not initialize a runtime or refresh models during rendering', () => {
    const initialize = jest.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized').mockResolvedValue(undefined);
    const refresh = jest.spyOn(ProviderWorkspaceRegistry, 'refreshModelCatalog').mockResolvedValue({ changed: false });
    dshSettingsTabRenderer.render({} as HTMLElement, createContext(false));
    expect(initialize).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(mockSettings.find(setting => setting.name === 'Native model catalog')?.components[0].disabled).toBe(true);
    expect(mockRenderEnvironment).toHaveBeenCalledWith(expect.objectContaining({ scope: 'provider:dsh' }));
  });

  it('refreshes catalog only on explicit enabled-provider action', async () => {
    const context = createContext(true);
    const initialize = jest.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized').mockResolvedValue(undefined);
    const refresh = jest.spyOn(ProviderWorkspaceRegistry, 'refreshModelCatalog').mockResolvedValue({ changed: true });
    dshSettingsTabRenderer.render({} as HTMLElement, context);
    await mockSettings.find(setting => setting.name === 'Native model catalog')?.components[0].click?.();
    expect(initialize).toHaveBeenCalledWith(context.plugin, 'dsh', 'model-catalog-refresh');
    expect(refresh).toHaveBeenCalledWith('dsh');
    expect(context.refreshModelSelectors).toHaveBeenCalled();
  });

  it('rejects invalid timeout inputs and saves valid values', async () => {
    const context = createContext(true);
    dshSettingsTabRenderer.render({} as HTMLElement, context);
    const timeout = mockSettings.find(setting => setting.name === 'Startup timeout (ms)')!.components[0];
    await timeout.change?.('NaN');
    expect(getDshProviderSettings(context.plugin.settings).startupTimeoutMs).toBe(90000);
    await timeout.change?.('120000');
    expect(getDshProviderSettings(context.plugin.settings).startupTimeoutMs).toBe(120000);
  });

  it('enables the explicit refresh control after enabling the provider on the same page', async () => {
    const context = createContext(false);
    dshSettingsTabRenderer.render({} as HTMLElement, context);
    const refresh = mockSettings.find(setting => setting.name === 'Native model catalog')!.components[0];
    await mockSettings.find(setting => setting.name === 'Enable DeepSeek Harness')!.components[0].change?.(true);
    expect(refresh.disabled).toBe(false);
  });
});
