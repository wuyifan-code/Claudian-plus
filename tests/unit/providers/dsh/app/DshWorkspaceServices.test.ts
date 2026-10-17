import type { ProviderHost } from '@/core/providers/ProviderHost';
import { createDshWorkspaceServices } from '@/providers/dsh/app/DshWorkspaceServices';
import { getDshProviderSettings, updateDshProviderSettings } from '@/providers/dsh/settings';

const mockCall = jest.fn();
const mockRelease = jest.fn();
const mockAcquire = jest.fn();
const mockDispose = jest.fn();
const mockNativeConnection = jest.fn();
let mockStart: (signal: AbortSignal) => Promise<unknown>;
jest.mock('@/providers/dsh/runtime/DshHost', () => ({
  DshHost: class {
    constructor(start: typeof mockStart) { mockStart = start; }
    acquire = mockAcquire;
    dispose = mockDispose;
  },
}));
jest.mock('@/providers/dsh/runtime/DshNativeConnection', () => ({
  createNativeDshConnection: (...args: unknown[]) => mockNativeConnection(...args),
}));
jest.mock('@/providers/dsh/ui/DshSettingsTab', () => ({ dshSettingsTabRenderer: { render: jest.fn() } }));

describe('DeepSeek Harness passive workspace services', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockAcquire.mockResolvedValue({ client: { call: mockCall }, home: '/native', ready: jest.fn(), release: mockRelease });
    mockNativeConnection.mockResolvedValue({ client: { call: mockCall }, home: '/native', dispose: jest.fn() });
  });

  function plugin(enabled = true) {
    const settings: Record<string, unknown> = {};
    updateDshProviderSettings(settings, { enabled });
    return { settings, mutateSettings: jest.fn(async mutation => mutation(settings)) } as unknown as ProviderHost;
  }

  it('constructs the host without starting it and skips catalog refresh when disabled', async () => {
    const services = createDshWorkspaceServices(plugin(false));
    expect(mockNativeConnection).not.toHaveBeenCalled();
    expect(mockAcquire).not.toHaveBeenCalled();
    expect(await services.refreshModelCatalog()).toEqual({ changed: false });
    expect(mockAcquire).not.toHaveBeenCalled();
    await services.dispose();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('flattens the native groups contract only for routable providers and releases its transient lease', async () => {
    const host = plugin();
    mockCall.mockResolvedValue({
      default: { provider: 'native', model: 'one' }, routableProviders: ['native'], failures: [],
      groups: [
        { id: 'native', name: 'Native', models: [{ id: 'one', name: 'One', reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } }] },
        { id: 'unroutable', name: 'Unavailable', models: [{ id: 'two', name: 'Two' }] },
      ],
    });
    const services = createDshWorkspaceServices(host);
    expect(await services.refreshModelCatalog()).toEqual({ changed: true, persistedSettingsChanged: true });
    expect(mockCall).toHaveBeenCalledWith('session/modelCatalog', {});
    expect(getDshProviderSettings(host.settings).models).toEqual([
      { provider: 'native', model: 'one', label: 'One', isDefault: true, reasoning: ['off', 'high'], defaultReasoning: 'high' },
    ]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('refreshes the default marker when the native default changes without changing the model list', async () => {
    const host = plugin();
    const catalog = {
      default: { provider: 'native', model: 'one' }, routableProviders: ['native'],
      groups: [{ id: 'native', models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }],
    };
    mockCall.mockResolvedValue(catalog);
    const services = createDshWorkspaceServices(host);
    await services.refreshModelCatalog();
    catalog.default.model = 'two';
    expect(await services.refreshModelCatalog()).toEqual({ changed: true, persistedSettingsChanged: true });
    expect(getDshProviderSettings(host.settings).models).toEqual([
      { provider: 'native', model: 'one', label: 'One' },
      { provider: 'native', model: 'two', label: 'Two', isDefault: true },
    ]);
    expect(await services.refreshModelCatalog()).toEqual({ changed: false });
  });

  it('does not mark a model as default when only its identifier matches another provider default', async () => {
    const host = plugin();
    mockCall.mockResolvedValue({
      default: { provider: 'unavailable', model: 'one' }, routableProviders: ['native'],
      groups: [{ id: 'native', models: [{ id: 'one', name: 'One' }] }],
    });
    await createDshWorkspaceServices(host).refreshModelCatalog();
    expect(getDshProviderSettings(host.settings).models).toEqual([
      { provider: 'native', model: 'one', label: 'One' },
    ]);
  });

  it('preserves prior settings when discovery fails and always releases the lease', async () => {
    const host = plugin();
    updateDshProviderSettings(host.settings, { models: [{ provider: 'native', model: 'old', label: 'Old' }] });
    mockCall.mockRejectedValue(new Error('Unavailable'));
    const services = createDshWorkspaceServices(host);
    await expect(services.refreshModelCatalog()).rejects.toThrow('Unavailable');
    expect(getDshProviderSettings(host.settings).models[0].model).toBe('old');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed native catalog without wiping prior models', async () => {
    const host = plugin();
    updateDshProviderSettings(host.settings, { models: [{ provider: 'native', model: 'old', label: 'Old' }] });
    mockCall.mockResolvedValue({ providers: [] });
    const services = createDshWorkspaceServices(host);
    await expect(services.refreshModelCatalog()).rejects.toThrow('catalog');
    expect(getDshProviderSettings(host.settings).models[0].model).toBe('old');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('discards discovery results when the native environment changes during the request', async () => {
    const host = plugin();
    mockCall.mockImplementation(async () => {
      updateDshProviderSettings(host.settings, { environmentVariables: 'DSH_HOME=/another/home' });
      return { default: { provider: 'native', model: 'one' }, routableProviders: ['native'], groups: [{ id: 'native', name: 'Native', models: [{ id: 'one', name: 'One' }] }], failures: [] };
    });
    const services = createDshWorkspaceServices(host);
    expect(await services.refreshModelCatalog()).toEqual({ changed: false });
    expect(getDshProviderSettings(host.settings).models).toEqual([]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('refuses to refresh models through an already running host from a different configuration', async () => {
    const host = plugin();
    mockCall.mockResolvedValue({ default: { provider: 'native', model: 'one' }, routableProviders: [], groups: [], failures: [] });
    mockAcquire.mockImplementationOnce(async () => {
      await mockStart(new AbortController().signal);
      return { client: { call: mockCall }, home: '/native', ready: jest.fn(), release: mockRelease };
    });
    const services = createDshWorkspaceServices(host);
    await services.refreshModelCatalog();
    updateDshProviderSettings(host.settings, { environmentVariables: 'DSH_HOME=/different' });
    mockCall.mockClear();
    await expect(services.refreshModelCatalog()).rejects.toThrow(/configuration/);
    expect(mockCall).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  it('keeps a running host valid when only environment formatting changes', async () => {
    const host = plugin();
    updateDshProviderSettings(host.settings, { environmentVariables: 'DSH_HOME=/native\nEXAMPLE=one' });
    mockCall.mockResolvedValue({ default: { provider: 'native', model: 'one' }, routableProviders: [], groups: [], failures: [] });
    mockAcquire.mockImplementationOnce(async () => {
      await mockStart(new AbortController().signal);
      return { client: { call: mockCall }, home: '/native', ready: jest.fn(), release: mockRelease };
    });
    const services = createDshWorkspaceServices(host);
    await services.refreshModelCatalog();
    updateDshProviderSettings(host.settings, { environmentVariables: '# Comment\nEXAMPLE=one\nDSH_HOME=/native\n' });
    await expect(services.refreshModelCatalog()).resolves.toEqual({ changed: false });
    expect(mockCall).toHaveBeenCalledTimes(2);
  });
});
