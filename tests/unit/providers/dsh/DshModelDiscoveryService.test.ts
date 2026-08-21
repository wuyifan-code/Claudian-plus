import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  DshModelDiscoveryService,
  getDshProfilePatchPaths,
  resolveDshHome,
} from '@/providers/dsh/app/DshModelDiscoveryService';
import { getDshProviderSettings } from '@/providers/dsh/settings';

function createSettingsBag(): Record<string, unknown> {
  return {
    model: '',
    providerConfigs: { dsh: { profile: 'acp-probe', providerRoute: '' } },
  };
}

describe('resolveDshHome', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('prefers DSH_HOME', () => {
    expect(resolveDshHome({ DSH_HOME: 'C:\\dsh-home', USERPROFILE: 'C:\\users\\x' })).toBe('C:\\dsh-home');
  });

  it('falls back to the home directory on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(resolveDshHome({ USERPROFILE: 'C:\\users\\x' })).toMatch(/\.dsh$/);
  });

  it('falls back to the home directory on posix', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(resolveDshHome({ HOME: '/home/x' })).toMatch(/\.dsh$/);
  });
});

describe('getDshProfilePatchPaths', () => {
  it('builds the profile patch and home patch paths', () => {
    // path.join uses the host platform separator, so the fixture and the
    // expectation must follow it to stay valid on Linux CI.
    const dshHome = process.platform === 'win32' ? 'C:\\dsh' : '/home/x/.dsh';
    expect(getDshProfilePatchPaths(dshHome, 'acp')).toEqual([
      [dshHome, 'profiles', 'acp', 'cordis.patch.yml'].join(path.sep),
      [dshHome, 'cordis.patch.yml'].join(path.sep),
    ]);
  });
});

describe('DshModelDiscoveryService', () => {
  let dshHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    dshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
    previousHome = process.env.DSH_HOME;
    process.env.DSH_HOME = dshHome;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousHome;
    }
    fs.rmSync(dshHome, { force: true, recursive: true });
  });

  function writeProfilePatch(profile: string, content: string): void {
    const dir = path.join(dshHome, 'profiles', profile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), content);
  }

  function createPlugin(bag: Record<string, unknown>) {
    return { settings: bag } as never;
  }

  it('discovers models and acp-agent pins from the profile patch', async () => {
    writeProfilePatch('acp-probe', `
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY
        models:
          - id: deepseek-v4-flash
            name: DeepSeek V4 Flash
            contextWindow: 1000000
- id: acp-agent
  config:
    provider: opencode-go
    model: deepseek-v4-flash
`);
    const bag = createSettingsBag();
    const service = new DshModelDiscoveryService(createPlugin(bag));

    const result = await service.refreshModelCatalog();

    expect(result.changed).toBe(true);
    const settings = getDshProviderSettings(bag);
    expect(settings.discoveredModels).toEqual([
      { rawId: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindow: 1000000 },
    ]);
    expect(settings.visibleModels).toEqual(['deepseek-v4-flash']);
    expect(bag.model).toBe('dsh:deepseek-v4-flash');
    expect(settings.providerRoute).toBe('opencode-go');
  });

  it('merges the home-level patch layer', async () => {
    writeProfilePatch('acp-probe', `
- id: llm-deepseek
  config:
    models:
      - id: deepseek-v4-pro
`);
    fs.writeFileSync(path.join(dshHome, 'cordis.patch.yml'), `
- id: llm-deepseek
  config:
    models:
      - id: deepseek-v4-flash
`);
    const bag = createSettingsBag();
    const service = new DshModelDiscoveryService(createPlugin(bag));

    await service.refreshModelCatalog();

    const settings = getDshProviderSettings(bag);
    expect(settings.discoveredModels.map((model) => model.rawId).sort()).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ]);
  });

  it('reports no change when nothing can be read', async () => {
    const bag = createSettingsBag();
    const service = new DshModelDiscoveryService(createPlugin(bag));
    const result = await service.refreshModelCatalog();
    expect(result.changed).toBe(false);
    expect(getDshProviderSettings(bag).discoveredModels).toEqual([]);
  });

  it('keeps existing visible models and model selection', async () => {
    writeProfilePatch('acp', `
- id: llm-deepseek
  config:
    models:
      - id: deepseek-v4-pro
      - id: deepseek-v4-flash
`);
    const bag = createSettingsBag();
    bag.model = 'dsh:deepseek-v4-pro';
    bag.providerConfigs = { dsh: { profile: 'acp', visibleModels: ['deepseek-v4-pro'] } };
    const service = new DshModelDiscoveryService(createPlugin(bag));

    await service.refreshModelCatalog();

    const settings = getDshProviderSettings(bag);
    expect(settings.visibleModels).toEqual(['deepseek-v4-pro']);
    expect(bag.model).toBe('dsh:deepseek-v4-pro');
  });
});
