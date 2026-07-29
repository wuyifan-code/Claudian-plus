import { migrateClaudeServiceSettings } from '@/providers/claude/services/ClaudeServiceMigration';
import { getClaudeProviderSettings } from '@/providers/claude/settings';

describe('migrateClaudeServiceSettings', () => {
  it('moves a legacy Claude-compatible endpoint into the service registry', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: {
        claude: {
          environmentVariables: [
            'ANTHROPIC_BASE_URL=https://example.test/',
            'ANTHROPIC_API_KEY=secret-value',
            'ANTHROPIC_MODEL=claude-sonnet-4-6',
            'CLAUDE_CODE_USE_BEDROCK=0',
          ].join('\n'),
        },
      },
      envSnippets: [],
      customContextLimits: {},
      customModelAliases: {},
    };
    const secrets = new Map<string, string>();

    const migrated = migrateClaudeServiceSettings(
      settings,
      { setSecret: (id, value) => { secrets.set(id, value); } },
      () => 'service-1',
    );

    expect(migrated).toBe(true);
    const claude = getClaudeProviderSettings(settings);
    expect(claude.environmentVariables).toBe('');
    expect(claude.defaultThirdPartyServiceId).toBe('service-1');
    expect(claude.thirdPartyServices).toHaveLength(1);
    expect(claude.thirdPartyServices[0]).toMatchObject({
      id: 'service-1',
      baseUrl: 'https://example.test',
      defaultModel: 'claude-sonnet-4-6',
      lightweightModel: 'claude-sonnet-4-6',
    });
    expect(secrets).toEqual(new Map([
      ['claudian-plus-claude-service-1', 'secret-value'],
    ]));
    expect(claude.thirdPartyServices[0].advancedEnvironmentVariables)
      .toContain('CLAUDE_CODE_USE_BEDROCK=0');
  });

  it('is idempotent once the legacy environment block has been removed', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: {
        claude: {
          environmentVariables: '',
          thirdPartyServices: [],
        },
      },
      envSnippets: [],
    };

    expect(migrateClaudeServiceSettings(
      settings,
      { setSecret: jest.fn() },
      () => 'service-1',
    )).toBe(false);
  });
});
