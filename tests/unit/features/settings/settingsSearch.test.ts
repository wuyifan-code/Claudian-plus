import {
  searchSettings,
  type SettingsSearchEntry,
} from '@/features/settings/settingsSearch';

describe('settingsSearch', () => {
  const sampleEntries: SettingsSearchEntry[] = [
    {
      categoryId: 'general',
      categoryLabel: 'General',
      settingKey: 'default-provider',
      name: 'Default provider',
      desc: 'Default agent provider for new conversations',
    },
    {
      categoryId: 'appearance',
      categoryLabel: 'Appearance',
      settingKey: 'theme-blob',
      name: 'Welcome blob animation',
      desc: 'Display interactive 2D or 3D blob in empty conversations',
    },
    {
      categoryId: 'providers:codex',
      categoryLabel: 'Providers / Codex',
      settingKey: 'codex-cli-path',
      name: 'Codex CLI path',
      desc: 'Path to codex executable binary on this device',
    },
    {
      categoryId: 'providers:claude',
      categoryLabel: 'Providers / Claude',
      settingKey: 'claude-cli-path',
      name: 'Claude CLI path',
      desc: 'Path to claude executable binary on this device',
    },
    {
      categoryId: 'advanced',
      categoryLabel: 'Advanced',
      settingKey: 'custom-limits',
      name: 'Custom Context Limits',
      desc: 'Configure token context limits for specific model aliases',
    },
  ];

  it('matches case-insensitive substring in setting name and ranks higher than description match', () => {
    const results = searchSettings('CLI path', sampleEntries);
    expect(results.length).toBe(2);
    expect(results[0].entry.settingKey).toBe('codex-cli-path');
    expect(results[0].matchType).toBe('name');
    expect(results[0].entry.categoryLabel).toBe('Providers / Codex');
  });

  it('matches case-insensitive substring in setting description', () => {
    const results = searchSettings('token context', sampleEntries);
    expect(results.length).toBe(1);
    expect(results[0].entry.settingKey).toBe('custom-limits');
    expect(results[0].matchType).toBe('desc');
  });

  it('ranks earlier substring occurrences higher', () => {
    const entries: SettingsSearchEntry[] = [
      { categoryId: '1', settingKey: 'k1', name: 'Other CLI tools' },
      { categoryId: '2', settingKey: 'k2', name: 'CLI configuration' },
    ];
    const results = searchSettings('CLI', entries);
    expect(results.map(r => r.entry.settingKey)).toEqual(['k2', 'k1']);
  });

  it('returns empty array when query is blank or does not match', () => {
    expect(searchSettings('', sampleEntries)).toEqual([]);
    expect(searchSettings('   ', sampleEntries)).toEqual([]);
    expect(searchSettings('nonexistentxyz', sampleEntries)).toEqual([]);
  });
});
