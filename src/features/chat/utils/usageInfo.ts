import type { UsageInfo } from '../../../core/types';

export function calculateUsagePercentage(contextTokens: number, contextWindow: number): number {
  return contextWindow > 0
    ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
    : 0;
}

export function recalculateUsageForModel(
  usage: UsageInfo,
  model: string,
  fallbackContextWindow: number,
  options?: { overrideContextWindow?: boolean },
): UsageInfo {
  // A window the user picked explicitly is a deliberate override: it wins over
  // a provider-reported window, which would otherwise snap the percentage back
  // on the next usage chunk.
  const preserveAuthoritativeWindow = options?.overrideContextWindow !== true
    && usage.contextWindowIsAuthoritative === true
    && usage.contextWindow > 0
    && usage.model === model;
  const contextWindow = preserveAuthoritativeWindow ? usage.contextWindow : fallbackContextWindow;

  return {
    ...usage,
    model,
    contextWindow,
    contextWindowIsAuthoritative: preserveAuthoritativeWindow,
    percentage: calculateUsagePercentage(usage.contextTokens, contextWindow),
  };
}

/** Whether the user pinned a context window for this model. */
export function hasContextWindowOverride(
  model: string | null | undefined,
  customLimits: Record<string, number> | undefined,
  providerOverrides?: (model: string, customLimits?: Record<string, number>) => boolean,
): boolean {
  if (!model || !customLimits) {
    return false;
  }
  // The provider owns its model-id spelling, so prefer its own answer about
  // whether a pin applies; the bare lookup only covers providers that never
  // normalize ids.
  if (providerOverrides) {
    return providerOverrides(model, customLimits);
  }
  const limit = customLimits[model];
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0;
}

/**
 * Pinned-window check that consults the provider first.
 *
 * Feature code knows the model id it holds, not the spelling a provider used
 * when the user pinned a capacity. Delegating keeps both sides consistent.
 */
export function isContextWindowPinned(
  uiConfig: { hasContextWindowOverride?: (model: string, customLimits?: Record<string, number>) => boolean } | null | undefined,
  model: string | null | undefined,
  customLimits: Record<string, number> | undefined,
): boolean {
  if (!model || !customLimits) {
    return false;
  }
  if (uiConfig?.hasContextWindowOverride) {
    return uiConfig.hasContextWindowOverride(model, customLimits);
  }
  return hasContextWindowOverride(model, customLimits);
}

/**
 * GPT-family models keep the window their provider reports: their real limits
 * are not user-tunable here, so the capacity selector stays out of the way.
 */
export function isGptFamilyModelId(model: string | null | undefined): boolean {
  const id = (model ?? '').trim().toLowerCase();
  if (!id) {
    return false;
  }
  // Strip a provider namespace such as `openai-codex/` or `pi/openai/`.
  const tail = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  return /^gpt(?:[-_.]|$)/.test(tail) || /(?:^|[/_-])gpt-oss(?:[-_.]|$)/.test(id);
}
