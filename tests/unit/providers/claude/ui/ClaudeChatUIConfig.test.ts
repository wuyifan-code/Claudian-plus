import { claudeChatUIConfig } from '@/providers/claude/ui/ClaudeChatUIConfig';

describe('claudeChatUIConfig', () => {
  it('defaults Claude models to high effort', () => {
    expect(claudeChatUIConfig.getDefaultReasoningValue('haiku', {})).toBe('high');
    expect(claudeChatUIConfig.getDefaultReasoningValue('custom-model', {})).toBe('high');
  });

  describe('getModelOptions', () => {
    it('appends settings-defined custom models after the built-in options', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6\nclaude-opus-4-6[1m]',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'haiku',
        'sonnet',
        'opus',
        'fable',
        'claude-code/claude-opus-4-6',
        'claude-code/claude-opus-4-6[1m]',
      ]);
      expect(options.slice(-2)).toEqual([
        {
          value: 'claude-code/claude-opus-4-6',
          label: 'Opus 4.6',
          description: 'Custom model',
        },
        {
          value: 'claude-code/claude-opus-4-6[1m]',
          label: 'Opus 4.6 (1M)',
          description: 'Custom model',
        },
      ]);
    });

    it('deduplicates settings-defined custom models against exact duplicates', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'haiku\nclaude-fable-5\nclaude-opus-4-6\nclaude-opus-4-6\n',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'haiku',
        'sonnet',
        'opus',
        'fable',
        'claude-code/claude-opus-4-6',
      ]);
    });

    it('formats dated settings-defined custom models with shortened date tags', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-5-20251101',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-code/claude-opus-4-5-20251101',
        label: 'Opus 4.5 (2511)',
        description: 'Custom model',
      });
    });

    it('formats a future fable custom model id without the built-in default', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-fable-6',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-code/claude-fable-6',
        label: 'Fable 6',
        description: 'Custom model',
      });
    });

    it('uses custom model aliases for settings-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-opus-4-6': 'Work Opus',
        },
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-code/claude-opus-4-6',
        label: 'Work Opus',
        description: 'Custom model',
      });
    });

    it('keeps environment-defined custom models as a full override', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-code/claude-sonnet-4-5',
          label: 'Sonnet 4.5',
          description: 'Custom model (model)',
          environmentTypes: ['model'],
        },
      ]);
    });

    it('uses custom model aliases for environment-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-sonnet-4-5': 'Gateway Sonnet',
        },
        providerConfigs: {
          claude: {
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-code/claude-sonnet-4-5',
          label: 'Gateway Sonnet',
          description: 'Custom model (model)',
          environmentTypes: ['model'],
        },
      ]);
    });
  });

  describe('getReasoningOptions', () => {
    it('hides xhigh on models that do not support it', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-sonnet-4-5', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
    });

    it('keeps xhigh on supported opus models', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-opus-4-7', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      expect(options.find(option => option.value === 'medium')?.label).toBe('Medium');
      expect(options.find(option => option.value === 'xhigh')?.label).toBe('xHigh');
    });

    it('keeps xhigh and ultra on fable models', () => {
      const options = claudeChatUIConfig.getReasoningOptions('fable', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    });

    it('uses effort options for custom model ids', () => {
      const options = claudeChatUIConfig.getReasoningOptions('custom-model', {});

      expect(options.map(option => option.value)).toEqual([
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]);
      expect(options.some(option => option.tokens !== undefined)).toBe(false);
    });
  });

  describe('applyModelDefaults', () => {
    it('persists the tier identity of an environment-mapped model', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'high',
        providerConfigs: {
          claude: {
            lastModel: 'haiku',
            environmentVariables: [
              'ANTHROPIC_DEFAULT_HAIKU_MODEL=custom-haiku',
              'ANTHROPIC_DEFAULT_FABLE_MODEL=gpt-4.1',
            ].join('\n'),
          },
        },
      };

      claudeChatUIConfig.applyModelDefaults('claude-code/gpt-4.1', settings);

      expect((settings.providerConfigs as Record<string, Record<string, unknown>>).claude.lastModel)
        .toBe('fable');
      expect((settings.providerConfigs as Record<string, Record<string, unknown>>).claude.modelEnvironmentType)
        .toBe('fable');
      expect(settings.lastCustomModel).toBeUndefined();
    });

    it('preserves the environment tier of a concrete legacy Fable ID', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'high',
        providerConfigs: {
          claude: {
            lastModel: 'fable',
            modelEnvironmentType: 'fable',
            environmentVariables: [
              'ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-fable-5',
              'ANTHROPIC_DEFAULT_FABLE_MODEL=gpt-4.1',
            ].join('\n'),
          },
        },
      };

      claudeChatUIConfig.applyModelDefaults('claude-code/claude-fable-5', settings);

      expect((settings.providerConfigs as Record<string, Record<string, unknown>>).claude)
        .toMatchObject({
          lastModel: 'haiku',
          modelEnvironmentType: 'haiku',
        });
    });

    it('clamps stale xhigh effort when switching to a custom sonnet model', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-sonnet-4-5', settings);

      expect(settings.effortLevel).toBe('high');
      expect(settings.lastCustomModel).toBe('claude-sonnet-4-5');
    });

    it('preserves xhigh on custom opus models that support it', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-opus-4-7', settings);

      expect(settings.effortLevel).toBe('xhigh');
    });
  });

  describe('applyModelProjectionDefaults', () => {
    it('preserves a user-selected effort for default tier models', () => {
      const settings: Record<string, unknown> = { effortLevel: 'low' };

      claudeChatUIConfig.applyModelProjectionDefaults?.('opus', settings);

      expect(settings.effortLevel).toBe('low');
    });

    it('preserves xhigh on the opus alias that supports it', () => {
      const settings: Record<string, unknown> = { effortLevel: 'xhigh' };

      claudeChatUIConfig.applyModelProjectionDefaults?.('opus', settings);

      expect(settings.effortLevel).toBe('xhigh');
    });

    it('clamps an effort the projected model cannot use', () => {
      const settings: Record<string, unknown> = { effortLevel: 'xhigh' };

      // The haiku alias does not support xhigh -> fall back to the default.
      claudeChatUIConfig.applyModelProjectionDefaults?.('haiku', settings);

      expect(settings.effortLevel).toBe('high');
    });

    it('preserves ultra on the opus alias that supports it', () => {
      const settings: Record<string, unknown> = { effortLevel: 'ultra' };

      claudeChatUIConfig.applyModelProjectionDefaults?.('opus', settings);

      expect(settings.effortLevel).toBe('ultra');
    });

    it('clamps ultra on sonnet which does not support it', () => {
      const settings: Record<string, unknown> = { effortLevel: 'ultra' };

      claudeChatUIConfig.applyModelProjectionDefaults?.('sonnet', settings);

      expect(settings.effortLevel).toBe('high');
    });
  });

  describe('getReasoningOptions ultra support', () => {
    it('includes Ultra for Opus and Fable models', () => {
      const opusOptions = claudeChatUIConfig.getReasoningOptions('opus', {});
      expect(opusOptions.some(o => o.value === 'ultra')).toBe(true);

      const fableOptions = claudeChatUIConfig.getReasoningOptions('fable', {});
      expect(fableOptions.some(o => o.value === 'ultra')).toBe(true);
    });

    it('does not include Ultra for Haiku or Sonnet models', () => {
      const haikuOptions = claudeChatUIConfig.getReasoningOptions('haiku', {});
      expect(haikuOptions.some(o => o.value === 'ultra')).toBe(false);

      const sonnetOptions = claudeChatUIConfig.getReasoningOptions('sonnet', {});
      expect(sonnetOptions.some(o => o.value === 'ultra')).toBe(false);
    });

    it('includes Ultra for versioned Opus >= 4.8', () => {
      const opus48Options = claudeChatUIConfig.getReasoningOptions('claude-opus-4-8', {});
      expect(opus48Options.some(o => o.value === 'ultra')).toBe(true);

      const opus46Options = claudeChatUIConfig.getReasoningOptions('claude-opus-4-6', {});
      expect(opus46Options.some(o => o.value === 'ultra')).toBe(false);
    });
  });
});
