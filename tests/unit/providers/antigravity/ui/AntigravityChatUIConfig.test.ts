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
  describe('model options (manual model id is the only source)', () => {
    it('offers no model options until a manual model id is configured', () => {
      expect(antigravityChatUIConfig.getModelOptions(createSettingsBag())).toEqual([]);
      expect(antigravityChatUIConfig.getModelOptions({})).toEqual([]);
    });

    it('offers the encoded manual model id when configured', () => {
      const options = antigravityChatUIConfig.getModelOptions(
        createSettingsBag({ manualModelId: MANUAL_MODEL_ID }),
      );

      expect(options).toEqual([
        {
          description: 'Manual model id from provider settings',
          label: MANUAL_MODEL_ID,
          value: ENCODED_MANUAL_MODEL_ID,
        },
      ]);
    });

    it('pins selections that existing sessions already use', () => {
      const options = antigravityChatUIConfig.getModelOptions({
        model: OTHER_ANTIGRAVITY_MODEL_ID,
        savedProviderModel: {
          antigravity: ENCODED_MANUAL_MODEL_ID,
        },
        ...createSettingsBag({ manualModelId: MANUAL_MODEL_ID }),
      });

      expect(options.map(option => option.value)).toEqual([
        ENCODED_MANUAL_MODEL_ID,
        OTHER_ANTIGRAVITY_MODEL_ID,
      ]);
    });

    it('never claims models owned by other providers', () => {
      const options = antigravityChatUIConfig.getModelOptions({
        model: 'openai-codex/gpt-5',
        savedProviderModel: { claude: 'claude-code/claude-sonnet-4' },
        ...createSettingsBag(),
      });

      expect(options).toEqual([]);
    });
  });

  describe('model ownership', () => {
    it('owns only antigravity-namespaced selections', () => {
      expect(antigravityChatUIConfig.ownsModel(ENCODED_MANUAL_MODEL_ID, createSettingsBag())).toBe(true);
      expect(antigravityChatUIConfig.ownsModel(OTHER_ANTIGRAVITY_MODEL_ID, createSettingsBag())).toBe(true);
      expect(antigravityChatUIConfig.ownsModel(MANUAL_MODEL_ID, createSettingsBag())).toBe(false);
      expect(antigravityChatUIConfig.ownsModel('openai-codex/gpt-5', createSettingsBag())).toBe(false);
      expect(antigravityChatUIConfig.ownsModel('claude-code/claude-sonnet-4', createSettingsBag())).toBe(false);
      expect(antigravityChatUIConfig.ownsModel('', createSettingsBag())).toBe(false);
    });

    it('treats every antigravity selection as a provider default model', () => {
      expect(antigravityChatUIConfig.isDefaultModel(ENCODED_MANUAL_MODEL_ID)).toBe(true);
      expect(antigravityChatUIConfig.isDefaultModel(MANUAL_MODEL_ID)).toBe(false);
      expect(antigravityChatUIConfig.isDefaultModel('openai-codex/gpt-5')).toBe(false);
    });
  });

  describe('default model', () => {
    it('has no default model until a manual model id is configured', () => {
      expect(antigravityChatUIConfig.getDefaultModel?.(createSettingsBag()) ?? null).toBeNull();
      expect(antigravityChatUIConfig.getDefaultModel?.({} as Record<string, unknown>) ?? null).toBeNull();
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
        .toBe(MANUAL_MODEL_ID);
      expect(antigravityChatUIConfig.normalizeModelVariant('openai-codex/gpt-5', createSettingsBag()))
        .toBe('openai-codex/gpt-5');
    });

    it('reports no custom model ids from environment variables', () => {
      expect(antigravityChatUIConfig.getCustomModelIds({ ANOTHER_MODEL: 'x' })).toEqual(new Set());
    });
  });

  it('falls back to the shared context window with custom overrides', () => {
    expect(antigravityChatUIConfig.getContextWindowSize(ENCODED_MANUAL_MODEL_ID)).toBe(200_000);
    expect(antigravityChatUIConfig.getContextWindowSize(ENCODED_MANUAL_MODEL_ID, {
      [ENCODED_MANUAL_MODEL_ID]: 123_000,
    })).toBe(123_000);
  });

  it('round-trips the manual model id through the shared selection encoding', () => {
    // Guards against encoding drift with the core selection map.
    expect(encodeAntigravityModelSelectionId(MANUAL_MODEL_ID)).toBe(ENCODED_MANUAL_MODEL_ID);
  });
});
