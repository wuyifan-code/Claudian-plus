import { encodeAntigravityModelSelectionId } from '@/providers/antigravity/models';
import { antigravityChatUIConfig } from '@/providers/antigravity/ui/AntigravityChatUIConfig';

const MANUAL_MODEL_ID = 'gemini-3.8-flash-low';
const ENCODED_MANUAL_MODEL_ID = 'antigravity/gemini-3.8-flash-low';
const OTHER_ANTIGRAVITY_MODEL_ID = 'antigravity/gemini-3.1-pro-low';

function createSettingsBag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      antigravity: { ...overrides },
    },
  };
}

describe('AntigravityChatUIConfig', () => {
  describe('model options', () => {
    it('offers verified default Gemini models when no manual model id is configured', () => {
      const options = antigravityChatUIConfig.getModelOptions(createSettingsBag());
      expect(options.length).toBeGreaterThan(0);
      expect(options.some(opt => opt.value === 'antigravity/gemini-3.8-flash-high')).toBe(true);
      expect(options.some(opt => opt.value === 'antigravity/gemini-3.8-flash-low')).toBe(true);
    });

    it('offers the encoded manual model id at the top when configured', () => {
      const customId = 'custom-gemini-experimental';
      const options = antigravityChatUIConfig.getModelOptions(
        createSettingsBag({ manualModelId: customId }),
      );

      expect(options[0]).toEqual({
        description: 'Manual model id from provider settings',
        label: customId,
        value: `antigravity/${customId}`,
      });
      expect(options.some(opt => opt.value === 'antigravity/gemini-3.8-flash-high')).toBe(true);
    });

    it('pins selections that existing sessions already use', () => {
      const options = antigravityChatUIConfig.getModelOptions({
        model: OTHER_ANTIGRAVITY_MODEL_ID,
        savedProviderModel: {
          antigravity: ENCODED_MANUAL_MODEL_ID,
        },
        ...createSettingsBag({ manualModelId: MANUAL_MODEL_ID }),
      });

      const values = options.map(option => option.value);
      expect(values).toContain(ENCODED_MANUAL_MODEL_ID);
      expect(values).toContain(OTHER_ANTIGRAVITY_MODEL_ID);
    });

    it('never claims models owned by other providers', () => {
      const options = antigravityChatUIConfig.getModelOptions({
        model: 'openai-codex/gpt-5',
        savedProviderModel: { claude: 'claude-code/claude-sonnet-4' },
        ...createSettingsBag(),
      });

      const values = options.map(option => option.value);
      expect(values).not.toContain('openai-codex/gpt-5');
      expect(values).not.toContain('claude-code/claude-sonnet-4');
    });
  });

  describe('model ownership', () => {
    it('owns antigravity-namespaced and gemini selections', () => {
      expect(antigravityChatUIConfig.ownsModel(ENCODED_MANUAL_MODEL_ID, createSettingsBag())).toBe(true);
      expect(antigravityChatUIConfig.ownsModel(OTHER_ANTIGRAVITY_MODEL_ID, createSettingsBag())).toBe(true);
      expect(antigravityChatUIConfig.ownsModel(MANUAL_MODEL_ID, createSettingsBag())).toBe(true);
      expect(antigravityChatUIConfig.ownsModel('Gemini 3.8 Flash (High)', createSettingsBag())).toBe(true);
      expect(antigravityChatUIConfig.ownsModel('openai-codex/gpt-5', createSettingsBag())).toBe(false);
      expect(antigravityChatUIConfig.ownsModel('claude-code/claude-sonnet-4', createSettingsBag())).toBe(false);
      expect(antigravityChatUIConfig.ownsModel('', createSettingsBag())).toBe(false);
    });

    it('treats every antigravity selection as a provider default model', () => {
      expect(antigravityChatUIConfig.isDefaultModel(ENCODED_MANUAL_MODEL_ID)).toBe(true);
      expect(antigravityChatUIConfig.isDefaultModel(MANUAL_MODEL_ID)).toBe(true);
      expect(antigravityChatUIConfig.isDefaultModel('openai-codex/gpt-5')).toBe(false);
    });
  });

  describe('default model', () => {
    it('defaults to gemini-3.8-flash-high when no manual model is configured', () => {
      expect(antigravityChatUIConfig.getDefaultModel?.(createSettingsBag()) ?? null)
        .toBe('antigravity/gemini-3.8-flash-high');
      expect(antigravityChatUIConfig.getDefaultModel?.({} as Record<string, unknown>) ?? null)
        .toBe('antigravity/gemini-3.8-flash-high');
    });

    it('defaults to the encoded manual model id once configured', () => {
      expect(antigravityChatUIConfig.getDefaultModel?.(createSettingsBag({ manualModelId: MANUAL_MODEL_ID })))
        .toBe(ENCODED_MANUAL_MODEL_ID);
    });
  });

  describe('reasoning', () => {
    it('exposes no reasoning control while effort semantics are unverified', () => {
      expect(antigravityChatUIConfig.isAdaptiveReasoningModel(ENCODED_MANUAL_MODEL_ID, createSettingsBag())).toBe(false);
      expect(antigravityChatUIConfig.getReasoningOptions(ENCODED_MANUAL_MODEL_ID, createSettingsBag())).toEqual([]);
      expect(antigravityChatUIConfig.getDefaultReasoningValue(ENCODED_MANUAL_MODEL_ID, createSettingsBag())).toBe('');
      expect(antigravityChatUIConfig.applyReasoningSelection).toBeUndefined();
    });
  });

  describe('unavailable entry points', () => {
    it('provides no permission-mode toggle of any kind', () => {
      expect(antigravityChatUIConfig.getPermissionModeToggle).toBeUndefined();
      expect(antigravityChatUIConfig.resolvePermissionMode).toBeUndefined();
      expect(antigravityChatUIConfig.applyPermissionMode).toBeUndefined();
    });

    it('provides no plan-mode, service-tier, or bang-bash entry points', () => {
      expect(antigravityChatUIConfig.getModeSelector?.(createSettingsBag()) ?? null).toBeNull();
      expect(antigravityChatUIConfig.getServiceTierToggle).toBeUndefined();
      expect(antigravityChatUIConfig.isBangBashEnabled).toBeUndefined();
    });

    it('never advertises a bypass through any serialized config data', () => {
      const serialized = JSON.stringify(antigravityChatUIConfig);
      expect(serialized).not.toContain('yolo');
      expect(serialized).not.toContain('skip');
      expect(serialized).not.toContain('dangerous');
    });

    it('carries no entry point for skills, MCP, images, commands, or plan mode', () => {
      // The chat layer gates those entry points on capabilities and on this
      // projection. Antigravity advertises none of them, so the projection must
      // not carry a hook that could render one.
      for (const key of Object.keys(antigravityChatUIConfig)) {
        expect(key).not.toMatch(/skill|mcp|image|command|plan|attach/i);
      }

      expect(Object.keys(antigravityChatUIConfig).sort()).toEqual([
        'applyModelDefaults',
        'getContextWindowSize',
        'getCustomModelIds',
        'getDefaultModel',
        'getDefaultReasoningValue',
        'getModeSelector',
        'getModelOptions',
        'getProviderIcon',
        'getReasoningOptions',
        'hasContextWindowOverride',
        'isAdaptiveReasoningModel',
        'isDefaultModel',
        'normalizeModelVariant',
        'ownsModel',
      ]);
    });
  });

  describe('model defaults', () => {
    it('applies owned selections to the settings bag', () => {
      const settingsBag = createSettingsBag();
      antigravityChatUIConfig.applyModelDefaults(ENCODED_MANUAL_MODEL_ID, settingsBag);
      expect(settingsBag.model).toBe(ENCODED_MANUAL_MODEL_ID);
    });

    it('clears foreign models instead of adopting them', () => {
      const settingsBag = createSettingsBag({ manualModelId: MANUAL_MODEL_ID });
      antigravityChatUIConfig.applyModelDefaults('openai-codex/gpt-5', settingsBag);
      expect(settingsBag.model).toBe('');
    });

    it('normalizes owned selections to the namespaced form and leaves foreign ids untouched', () => {
      expect(antigravityChatUIConfig.normalizeModelVariant(ENCODED_MANUAL_MODEL_ID, createSettingsBag()))
        .toBe(ENCODED_MANUAL_MODEL_ID);
      expect(antigravityChatUIConfig.normalizeModelVariant(MANUAL_MODEL_ID, createSettingsBag()))
        .toBe(ENCODED_MANUAL_MODEL_ID);
      expect(antigravityChatUIConfig.normalizeModelVariant('openai-codex/gpt-5', createSettingsBag()))
        .toBe('openai-codex/gpt-5');
    });

    it('reports no custom model ids from environment variables', () => {
      expect(antigravityChatUIConfig.getCustomModelIds({ ANOTHER_MODEL: 'x' })).toEqual(new Set());
    });
  });

  it('falls back to the model family window with custom overrides', () => {
    // A Gemini model without a pin gets its real 1M window, not a 200K guess.
    expect(antigravityChatUIConfig.getContextWindowSize(ENCODED_MANUAL_MODEL_ID)).toBe(1_000_000);
    expect(antigravityChatUIConfig.getContextWindowSize(ENCODED_MANUAL_MODEL_ID, {
      [ENCODED_MANUAL_MODEL_ID]: 123_000,
    })).toBe(123_000);
  });

  describe('context window', () => {
    it('defaults Gemini models to the 1M window they run with', () => {
      expect(antigravityChatUIConfig.getContextWindowSize('antigravity/gemini-3.8-flash-high'))
        .toBe(1_000_000);
      expect(antigravityChatUIConfig.getContextWindowSize('gemini-3.1-pro-low')).toBe(1_000_000);
    });

    it('keeps Claude-hosted Antigravity models on the 200K window', () => {
      expect(antigravityChatUIConfig.getContextWindowSize('antigravity/claude-sonnet-4-6'))
        .toBe(200_000);
    });

    it('keeps the conservative default for an unknown model id', () => {
      expect(antigravityChatUIConfig.getContextWindowSize('antigravity/custom-experimental'))
        .toBe(200_000);
    });

    it('honors a pin written under the encoded selection id when the runtime reports the raw id', () => {
      // The toolbar writes `antigravity/gemini-...`; agy's usage chunk reports the
      // bare runtime id. A bare lookup here silently dropped the user's choice.
      expect(antigravityChatUIConfig.getContextWindowSize('gemini-3.8-flash-high', {
        'antigravity/gemini-3.8-flash-high': 300_000,
      })).toBe(300_000);
    });

    it('honors a pin written under the raw id when the selection id is passed in', () => {
      expect(antigravityChatUIConfig.getContextWindowSize('antigravity/gemini-3.8-flash-high', {
        'gemini-3.8-flash-high': 600_000,
      })).toBe(600_000);
    });

    it('honors a pin written under a model label', () => {
      expect(antigravityChatUIConfig.getContextWindowSize('antigravity/gemini-3.8-flash-high', {
        'Gemini 3.8 Flash (High)': 300_000,
      })).toBe(300_000);
    });

    it('reports whether the user pinned a window for this model', () => {
      expect(antigravityChatUIConfig.hasContextWindowOverride?.('gemini-3.8-flash-high', {
        'antigravity/gemini-3.8-flash-high': 300_000,
      })).toBe(true);
      expect(antigravityChatUIConfig.hasContextWindowOverride?.('gemini-3.8-flash-high', {}))
        .toBe(false);
      expect(antigravityChatUIConfig.hasContextWindowOverride?.('gemini-3.8-flash-high'))
        .toBe(false);
    });

    it('ignores an invalid pinned value', () => {
      expect(antigravityChatUIConfig.getContextWindowSize('gemini-3.8-flash-high', {
        'gemini-3.8-flash-high': 0,
      })).toBe(1_000_000);
      expect(antigravityChatUIConfig.getContextWindowSize('gemini-3.8-flash-high', {
        'gemini-3.8-flash-high': Number.NaN,
      })).toBe(1_000_000);
    });
  });

  it('round-trips the manual model id through the shared selection encoding', () => {
    // Guards against encoding drift with the core selection map.
    expect(encodeAntigravityModelSelectionId(MANUAL_MODEL_ID)).toBe(ENCODED_MANUAL_MODEL_ID);
  });

  it('provides the official Gemini / Antigravity SVG icon', () => {
    const icon = antigravityChatUIConfig.getProviderIcon?.();
    expect(icon).toBeDefined();
    expect(icon).toHaveProperty('path');
    expect(icon?.viewBox).toBe('0 0 24 24');
  });
});
