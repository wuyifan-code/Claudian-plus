import * as fs from 'node:fs';

const mockCliResolverReset = jest.fn();
const mockResolveFromSettings = jest.fn();

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn(),
  exec: jest.fn(),
  execSync: jest.fn(),
  execFile: jest.fn(),
  execFileSync: jest.fn(),
}));

// CLI-path validation and diagnostics resolution are filesystem lookups; they
// must be observable so the tab can be checked for spawning the CLI instead.
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn(() => true),
  statSync: jest.fn(() => ({ isFile: () => true })),
}));

jest.mock('@/core/providers/ProviderSettingsCoordinator', () => ({
  ProviderSettingsCoordinator: {
    applyProviderEnablement: jest.fn((settings: Record<string, unknown>, providerId: string, enabled: boolean) => {
      const providerConfigs = settings.providerConfigs as Record<string, { enabled: boolean }>;
      providerConfigs[providerId].enabled = enabled;
    }),
  },
}));

interface MockToggleComponent {
  onChangeCallback: ((value: boolean) => Promise<void> | void) | null;
  setValue: jest.Mock;
  value: boolean;
  onChange(callback: (value: boolean) => Promise<void> | void): MockToggleComponent;
}

interface MockTextComponent {
  inputEl: {
    addClass: jest.Mock;
    style: Record<string, string>;
    toggleClass: jest.Mock;
    value: string;
  };
  onChangeCallback: ((value: string) => Promise<void> | void) | null;
  setPlaceholder: jest.Mock;
  setValue: jest.Mock;
  value: string;
  onChange(callback: (value: string) => Promise<void> | void): MockTextComponent;
}

interface MockButtonComponent {
  disabled: boolean;
  onClickCallback: (() => Promise<void> | void) | null;
  setButtonText: jest.Mock;
  setDisabled: jest.Mock;
  text: string;
  onClick(callback: () => Promise<void> | void): MockButtonComponent;
}

class MockSetting {
  buttonComponents: MockButtonComponent[] = [];
  desc = '';
  heading = false;
  name = '';
  textComponents: MockTextComponent[] = [];
  toggleComponents: MockToggleComponent[] = [];

  constructor(_container: unknown) {
    createdSettings.push(this);
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  setHeading(): this {
    this.heading = true;
    return this;
  }

  addToggle(callback: (toggle: MockToggleComponent) => void): this {
    const component = createToggleComponent();
    this.toggleComponents.push(component);
    callback(component);
    return this;
  }

  addText(callback: (text: MockTextComponent) => void): this {
    const component = createTextComponent();
    this.textComponents.push(component);
    callback(component);
    return this;
  }

  addButton(callback: (button: MockButtonComponent) => void): this {
    const component = createButtonComponent();
    this.buttonComponents.push(component);
    callback(component);
    return this;
  }
}

jest.mock('obsidian', () => ({
  Notice: class MockNotice {
    constructor(message: string) {
      mockNotices.push(message);
    }
  },
  Setting: MockSetting,
}));
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));
jest.mock('@/providers/antigravity/app/AntigravityWorkspaceServices', () => ({
  maybeGetAntigravityWorkspaceServices: jest.fn(() => ({
    cliResolver: {
      reset: mockCliResolverReset,
      resolveFromSettings: mockResolveFromSettings,
    },
  })),
}));

import * as childProcess from 'node:child_process';

import { DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS } from '@/providers/antigravity/settings';
import { getAntigravityProviderSettings } from '@/providers/antigravity/settings';
import { antigravitySettingsTabRenderer } from '@/providers/antigravity/ui/AntigravitySettingsTab';

const createdSettings: MockSetting[] = [];
const createdDomElements: any[] = [];
const mockNotices: string[] = [];
const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;
const spawnSpies = [
  childProcess.spawn,
  childProcess.spawnSync,
  childProcess.exec,
  childProcess.execSync,
  childProcess.execFile,
  childProcess.execFileSync,
] as unknown as jest.Mock[];

function createToggleComponent(): MockToggleComponent {
  const component = {} as MockToggleComponent;
  component.onChangeCallback = null;
  component.value = false;
  component.setValue = jest.fn((value: boolean) => {
    component.value = value;
    return component;
  });
  component.onChange = (callback: (value: boolean) => Promise<void> | void): MockToggleComponent => {
    component.onChangeCallback = callback;
    return component;
  };
  return component;
}

function createTextComponent(): MockTextComponent {
  const component = {} as MockTextComponent;
  component.inputEl = {
    addClass: jest.fn(),
    style: {},
    toggleClass: jest.fn(),
    value: '',
  };
  component.onChangeCallback = null;
  component.value = '';
  component.setPlaceholder = jest.fn(() => component);
  component.setValue = jest.fn((value: string) => {
    component.value = value;
    component.inputEl.value = value;
    return component;
  });
  component.onChange = (callback: (value: string) => Promise<void> | void): MockTextComponent => {
    component.onChangeCallback = callback;
    return component;
  };
  return component;
}

function createButtonComponent(): MockButtonComponent {
  const component = {} as MockButtonComponent;
  component.disabled = false;
  component.onClickCallback = null;
  component.text = '';
  component.setButtonText = jest.fn((value: string) => {
    component.text = value;
    return component;
  });
  component.setDisabled = jest.fn((value: boolean) => {
    component.disabled = value;
    return component;
  });
  component.onClick = (callback: () => Promise<void> | void): MockButtonComponent => {
    component.onClickCallback = callback;
    return component;
  };
  return component;
}

function createElement(): any {
  const classes = new Set<string>();
  const element: any = {
    style: {},
    classList: {
      add: jest.fn((cls: string) => classes.add(cls)),
      remove: jest.fn((cls: string) => classes.delete(cls)),
      toggle: jest.fn(),
      contains: jest.fn((cls: string) => classes.has(cls)),
    },
    addClass: jest.fn((cls: string) => {
      cls.split(/\s+/).filter(Boolean).forEach((item) => classes.add(item));
    }),
    removeClass: jest.fn(),
    toggleClass: jest.fn((cls: string, force: boolean) => {
      if (force) {
        classes.add(cls);
      } else {
        classes.delete(cls);
      }
    }),
    hasClass: jest.fn((cls: string) => classes.has(cls)),
    setText: jest.fn((value: string) => {
      element.text = value;
    }),
    empty: jest.fn(),
    createEl: jest.fn((tag?: string, attrs?: Record<string, unknown>) => {
      const child = createElement();
      child.tag = tag;
      if (attrs && typeof attrs.text === 'string') {
        child.text = attrs.text;
      }
      if (attrs && typeof attrs.cls === 'string') {
        child.cls = attrs.cls;
      }
      createdDomElements.push(child);
      return child;
    }),
    createDiv: jest.fn((attrs?: Record<string, unknown>) => {
      const child = createElement();
      child.tag = 'div';
      if (attrs && typeof attrs.cls === 'string') {
        child.cls = attrs.cls;
      }
      createdDomElements.push(child);
      return child;
    }),
  };

  return element;
}

function createContext(settings: Record<string, unknown>) {
  const saveSettings = jest.fn().mockResolvedValue(undefined);
  return {
    plugin: {
      manifest: { version: '1.2.3-test' },
      recycleProviderRuntimes: jest.fn().mockResolvedValue(undefined),
      saveSettings,
      settings,
      mutateSettings: jest.fn(async (mutation: (current: any) => void | Promise<void>) => {
        await mutation(settings);
        await saveSettings();
      }),
    },
    refreshModelSelectors: jest.fn(),
    refreshTitleGenerationModelOptions: jest.fn(),
    renderHiddenProviderCommandSetting: jest.fn(),
  };
}

function render(settings: Record<string, unknown>) {
  const context = createContext(settings);
  antigravitySettingsTabRenderer.render(createElement(), context as any);
  return context;
}

async function flushPromises(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

function findSetting(name: string): MockSetting {
  const setting = createdSettings.find(entry => entry.name === name);
  if (!setting) {
    throw new Error(`Setting not found: ${name}`);
  }
  return setting;
}

function findDiagnosticsParagraphs(): string[] {
  return createdDomElements
    .filter(element => element.tag === 'p' && typeof element.text === 'string')
    .map(element => element.text as string);
}

function allRenderedCopy(): string[] {
  return [
    ...createdSettings.map(setting => `${setting.name}\n${setting.desc}`),
    ...findDiagnosticsParagraphs(),
  ];
}

function createDefaultSettingsBag(): Record<string, unknown> {
  return {
    providerConfigs: {
      antigravity: { ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS },
    },
  };
}

const PRIVATE_WINDOWS_PATH = 'C:\\Users\\ada\\AppData\\Local\\agy\\bin\\agy.EXE';

/**
 * jsdom/node exposes no clipboard; the tab guards the call, and tests install a
 * writable property so a copy action is observable without a real clipboard.
 */
function mockClipboard(writeText: jest.Mock): void {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
    writable: true,
  });
}

describe('AntigravitySettingsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createdSettings.length = 0;
    createdDomElements.length = 0;
    mockNotices.length = 0;
    mockedExists.mockReturnValue(true);
    mockedStat.mockReturnValue({ isFile: () => true });
    Reflect.deleteProperty(globalThis.navigator, 'clipboard');
  });

  it('renders an enable toggle that defaults to off and persists enablement', async () => {
    const settings = createDefaultSettingsBag();
    const context = render(settings);

    const toggle = findSetting('Enable Antigravity').toggleComponents[0];
    expect(toggle.value).toBe(false);

    await toggle.onChangeCallback?.(true);
    await flushPromises();

    expect(getAntigravityProviderSettings(settings).enabled).toBe(true);
    expect(context.plugin.saveSettings).toHaveBeenCalled();
    expect(context.refreshModelSelectors).toHaveBeenCalled();
    expect(context.refreshTitleGenerationModelOptions).toHaveBeenCalled();
  });

  it('contains no permission-bypass or plan-mode control', () => {
    render(createDefaultSettingsBag());

    const forbidden = /skip|yolo|dangerous|permission|plan mode|auto-approve/i;
    for (const copy of allRenderedCopy()) {
      expect(copy).not.toMatch(forbidden);
    }
    expect(createdSettings.every(setting => setting.toggleComponents.length <= 1)).toBe(true);
  });

  it('exposes no skills, MCP, image, or command entries', () => {
    const context = render(createDefaultSettingsBag());

    expect(context.renderHiddenProviderCommandSetting).not.toHaveBeenCalled();
    expect(createdSettings.some(setting => /skills|mcp|image|command/i.test(setting.name))).toBe(false);
  });

  it('renders only the enable switch and the local diagnostics controls', () => {
    render(createDefaultSettingsBag());

    // Every control is a clickable entry point, so the surface is pinned: any
    // unverified feature must be described in text instead of gaining one.
    expect(createdSettings.flatMap(setting => setting.toggleComponents)).toHaveLength(1);
    expect(findSetting('Enable Antigravity').toggleComponents).toHaveLength(1);

    expect(createdSettings.flatMap(setting => setting.buttonComponents)).toHaveLength(2);
    expect(findSetting('Refresh diagnostics').buttonComponents).toHaveLength(1);
    expect(findSetting('Copy diagnostics snapshot').buttonComponents).toHaveLength(1);

    expect(createdDomElements.filter(element => element.tag === 'button')).toHaveLength(0);
  });

  it('states that consumption follows the account agy configuration without quota claims', () => {
    render(createDefaultSettingsBag());

    const copy = allRenderedCopy();
    // Provider tabs name the CLI in code spans; strip them so the assertion
    // pins the statement itself rather than its presentation.
    const plainCopy = copy.map(text => text.replace(/`/g, ''));
    expect(plainCopy.some(text => text.includes('agy configuration'))).toBe(true);
    for (const text of copy) {
      expect(text).not.toMatch(/quota|credit|free \w+ requests?/i);
    }
  });

  it('persists a validated per-host CLI path and resets the resolver', async () => {
    const settings = createDefaultSettingsBag();
    const context = render(settings);
    const cliInput = findSetting('CLI path').textComponents[0];

    mockedExists.mockReturnValue(false);
    await cliInput.onChangeCallback?.('/missing/agy');
    await flushPromises();
    expect(context.plugin.saveSettings).not.toHaveBeenCalled();
    expect(mockCliResolverReset).not.toHaveBeenCalled();

    mockedExists.mockReturnValue(true);
    await cliInput.onChangeCallback?.('C:\\agy\\agy.EXE');
    await flushPromises();
    expect(getAntigravityProviderSettings(settings).cliPathsByHost).toEqual({
      'current-host': 'C:\\agy\\agy.EXE',
    });
    expect(mockCliResolverReset).toHaveBeenCalled();
    expect(context.plugin.recycleProviderRuntimes).toHaveBeenCalledWith('antigravity');
  });

  it('persists the manual model id and refreshes model selectors', async () => {
    const settings = createDefaultSettingsBag();
    const context = render(settings);

    await findSetting('Manual model id').textComponents[0].onChangeCallback?.(' gemini-3.8-flash-low ');
    await flushPromises();

    expect(getAntigravityProviderSettings(settings).manualModelId).toBe('gemini-3.8-flash-low');
    expect(context.refreshModelSelectors).toHaveBeenCalled();
  });

  it('persists a positive integer timeout and ignores invalid input', async () => {
    const settings = createDefaultSettingsBag();
    const context = render(settings);
    const timeoutInput = findSetting('Turn timeout (ms)').textComponents[0];

    await timeoutInput.onChangeCallback?.('45000');
    await flushPromises();
    expect(getAntigravityProviderSettings(settings).timeoutMs).toBe(45000);

    await timeoutInput.onChangeCallback?.('not-a-number');
    await flushPromises();
    expect(getAntigravityProviderSettings(settings).timeoutMs).toBe(45000);
    expect(context.plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('refreshes diagnostics from local state only, never spawning the CLI or a model request', async () => {
    const settings = createDefaultSettingsBag();
    render(settings);

    const refreshSetting = findSetting('Refresh diagnostics');
    expect(refreshSetting.buttonComponents).toHaveLength(1);

    mockResolveFromSettings.mockReturnValue('C:\\agy\\agy.EXE');
    await refreshSetting.buttonComponents[0].onClickCallback?.();
    await flushPromises();

    expect(getAntigravityProviderSettings(settings).diagnosticsRefreshToken).toBe(1);
    expect(mockResolveFromSettings).toHaveBeenCalled();
    expect(findDiagnosticsParagraphs().join('\n')).toContain('C:\\agy\\agy.EXE');
    for (const spawnSpy of spawnSpies) {
      expect(spawnSpy).not.toHaveBeenCalled();
    }
  });

  it('reports an unresolved CLI path instead of a clickable probe', async () => {
    const settings = createDefaultSettingsBag();
    render(settings);

    mockResolveFromSettings.mockReturnValue(null);
    await findSetting('Refresh diagnostics').buttonComponents[0].onClickCallback?.();
    await flushPromises();

    const diagnosticsText = findDiagnosticsParagraphs().join('\n');
    expect(diagnosticsText).toContain('agy not found');
    expect(diagnosticsText).toContain('never launched');
  });

  it('shows that no startup failure has been recorded yet', () => {
    render(createDefaultSettingsBag());

    const diagnosticsText = findDiagnosticsParagraphs().join('\n');
    expect(diagnosticsText).toContain('Last failure: nothing recorded');
  });

  it('renders the recorded failure category, time and detail', async () => {
    const recordedAt = 1_700_000_000_000;
    const settings = createDefaultSettingsBag();
    (settings.providerConfigs as Record<string, Record<string, unknown>>).antigravity.lastFailure = {
      category: 'spawn-failed',
      recordedAt,
      detail: 'exit code 1',
    };

    render(settings);

    const diagnosticsText = findDiagnosticsParagraphs().join('\n');
    expect(diagnosticsText).toContain('spawn-failed');
    expect(diagnosticsText).toContain('exit code 1');
    expect(diagnosticsText).toContain(new Date(recordedAt).toLocaleString());

    await findSetting('Refresh diagnostics').buttonComponents[0].onClickCallback?.();
    await flushPromises();
    expect(findDiagnosticsParagraphs().join('\n')).toContain('spawn-failed');
  });

  it('copies a redacted snapshot of local state without spawning the CLI', async () => {
    const writeText = jest.fn((_text: string) => Promise.resolve());
    mockClipboard(writeText);
    const settings: Record<string, unknown> = {
      providerConfigs: {
        antigravity: {
          ...DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS,
          cliPathsByHost: { 'current-host': PRIVATE_WINDOWS_PATH },
          lastFailure: {
            category: 'spawn-failed',
            recordedAt: 42,
            // A path that reached storage by some other route must not survive a copy.
            detail: `ENOENT ${PRIVATE_WINDOWS_PATH}`,
          },
        },
      },
    };
    mockResolveFromSettings.mockReturnValue(PRIVATE_WINDOWS_PATH);
    render(settings);

    await findSetting('Copy diagnostics snapshot').buttonComponents[0].onClickCallback?.();
    await flushPromises();

    expect(writeText).toHaveBeenCalledTimes(1);
    const report = writeText.mock.calls[0][0];
    const snapshot = JSON.parse(report);
    expect(snapshot).toMatchObject({
      providerId: 'antigravity',
      pluginVersion: '1.2.3-test',
      cli: { resolved: true, executable: 'agy.EXE' },
      capabilities: { supportsPersistentRuntime: false, reasoningControl: 'none' },
      lastFailure: { category: 'spawn-failed', recordedAt: 42, detail: 'ENOENT [redacted-path]' },
    });
    expect(report).not.toContain('ada');
    expect(report).not.toContain('Users');

    for (const spawnSpy of spawnSpies) {
      expect(spawnSpy).not.toHaveBeenCalled();
    }
    expect(mockNotices).toHaveLength(1);
  });

  it('reports a clipboard failure instead of throwing', async () => {
    mockClipboard(jest.fn(() => Promise.reject(new Error('clipboard denied'))));
    render(createDefaultSettingsBag());

    await expect(
      findSetting('Copy diagnostics snapshot').buttonComponents[0].onClickCallback?.(),
    ).resolves.toBeUndefined();

    expect(mockNotices).toHaveLength(1);
    expect(mockNotices[0]).not.toContain(PRIVATE_WINDOWS_PATH);
  });
});
