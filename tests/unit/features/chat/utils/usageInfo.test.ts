import { TEST_CODEX_MODEL } from '@test/helpers/codexModels';

import {
  calculateUsagePercentage,
  hasContextWindowOverride,
  isGptFamilyModelId,
  recalculateUsageForModel,
} from '@/features/chat/utils/usageInfo';

describe('usageInfo', () => {
  describe('calculateUsagePercentage', () => {
    it('rounds to the nearest integer and clamps to 0-100', () => {
      expect(calculateUsagePercentage(13623, 100000)).toBe(14);
      expect(calculateUsagePercentage(500000, 200000)).toBe(100);
      expect(calculateUsagePercentage(500, 0)).toBe(0);
    });
  });

  describe('recalculateUsageForModel', () => {
    it('preserves an authoritative context window for the same model', () => {
      const usage = {
        model: TEST_CODEX_MODEL,
        inputTokens: 1000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 258400,
        contextWindowIsAuthoritative: true,
        contextTokens: 129200,
        percentage: 50,
      };

      expect(recalculateUsageForModel(usage, TEST_CODEX_MODEL, 200000)).toEqual({
        ...usage,
        model: TEST_CODEX_MODEL,
        contextWindow: 258400,
        contextWindowIsAuthoritative: true,
        percentage: 50,
      });
    });

    it('falls back to the declared context window when the provider reports none', () => {
      // Antigravity (agy) reports token counts but no context window, so the
      // provider-owned window has to supply the denominator.
      const usage = {
        model: 'gemini-3.8-flash-low',
        inputTokens: 50000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 0,
        contextWindowIsAuthoritative: false,
        contextTokens: 50000,
        percentage: 0,
      };

      expect(recalculateUsageForModel(usage, 'gemini-3.8-flash-low', 200000)).toEqual({
        ...usage,
        contextWindow: 200000,
        contextWindowIsAuthoritative: false,
        percentage: 25,
      });
    });

    it('keeps the usage untouched when no context window is known', () => {
      const usage = {
        model: 'gemini-3.8-flash-low',
        inputTokens: 50000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 0,
        contextWindowIsAuthoritative: false,
        contextTokens: 50000,
        percentage: 0,
      };

      expect(recalculateUsageForModel(usage, 'gemini-3.8-flash-low', 0)).toEqual({
        ...usage,
        contextWindow: 0,
        contextWindowIsAuthoritative: false,
        percentage: 0,
      });
    });

    it('falls back to the UI context window when the model changes', () => {
      const usage = {
        model: TEST_CODEX_MODEL,
        inputTokens: 1000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 258400,
        contextWindowIsAuthoritative: true,
        contextTokens: 100000,
        percentage: 39,
      };

      expect(recalculateUsageForModel(usage, 'gpt-5.4-mini', 200000)).toEqual({
        ...usage,
        model: 'gpt-5.4-mini',
        contextWindow: 200000,
        contextWindowIsAuthoritative: false,
        percentage: 50,
      });
    });

    it('lets an explicit override beat an authoritative provider window', () => {
      const usage = {
        model: TEST_CODEX_MODEL,
        inputTokens: 1000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 258400,
        contextWindowIsAuthoritative: true,
        contextTokens: 129_200,
        percentage: 50,
      };

      expect(recalculateUsageForModel(usage, TEST_CODEX_MODEL, 600_000, {
        overrideContextWindow: true,
      })).toEqual({
        ...usage,
        contextWindow: 600_000,
        contextWindowIsAuthoritative: false,
        percentage: 22,
      });
    });
  });

  describe('hasContextWindowOverride', () => {
    it('reports a pin only for a positive finite value on the given model', () => {
      expect(hasContextWindowOverride('sonnet', { sonnet: 300_000 })).toBe(true);
      expect(hasContextWindowOverride('sonnet', { other: 300_000 })).toBe(false);
      expect(hasContextWindowOverride('sonnet', { sonnet: 0 })).toBe(false);
      expect(hasContextWindowOverride('sonnet', undefined)).toBe(false);
      expect(hasContextWindowOverride(undefined, { sonnet: 300_000 })).toBe(false);
    });
  });

  describe('isGptFamilyModelId', () => {
    it('matches GPT ids behind provider namespaces', () => {
      expect(isGptFamilyModelId('gpt-5.4-mini')).toBe(true);
      expect(isGptFamilyModelId('gpt-5.3-codex-spark')).toBe(true);
      expect(isGptFamilyModelId('openai-codex/gpt-5.4-mini')).toBe(true);
      expect(isGptFamilyModelId('pi/openai/gpt-5')).toBe(true);
      expect(isGptFamilyModelId('gpt-oss-120b-medium')).toBe(true);
      expect(isGptFamilyModelId('antigravity/gpt-oss-120b-medium')).toBe(true);
    });

    it('leaves non-GPT models selectable', () => {
      expect(isGptFamilyModelId('sonnet')).toBe(false);
      expect(isGptFamilyModelId('claude-opus-4-6-thinking')).toBe(false);
      expect(isGptFamilyModelId('gemini-3.8-flash-high')).toBe(false);
      expect(isGptFamilyModelId('antigravity/gemini-3.8-flash-high')).toBe(false);
      expect(isGptFamilyModelId('grok-4')).toBe(false);
      expect(isGptFamilyModelId('')).toBe(false);
      expect(isGptFamilyModelId(undefined)).toBe(false);
    });
  });
});
