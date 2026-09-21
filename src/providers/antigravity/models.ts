import {
  decodeProviderModelSelectionId,
  encodeProviderModelSelectionId,
} from '../../core/providers/modelSelection';
import { ANTIGRAVITY_PROVIDER_ID } from './runtime/AntigravityLaunchSpec';

export { ANTIGRAVITY_PROVIDER_ID };
export const ANTIGRAVITY_MODEL_PREFIX = 'antigravity/';

export interface AntigravityReasoningEffortSupport {
  reason: string;
  supported: false;
}

export interface AntigravityModelDiscoverySupport {
  available: false;
  reason: string;
}

/**
 * Reasoning-effort control status for Antigravity.
 *
 * `agy --help` (1.1.27) advertises an `--effort` flag, but A0 (2026-09-18,
 * see `.context/antigravity/compatibility.md`) never verified its headless
 * semantics against a live model. Until a verified run proves the flag
 * end-to-end, the settings expose no effort control and capabilities must
 * report reasoning control as unsupported.
 */
export const ANTIGRAVITY_REASONING_EFFORT_SUPPORT: Readonly<AntigravityReasoningEffortSupport> = Object.freeze({
  supported: false,
  reason: 'The agy --effort flag is docs-only; its headless semantics were never verified against a live model.',
});

/**
 * Model-discovery status for Antigravity.
 *
 * `agy models` prints a TUI table that is explicitly not a stable API (A0 §3),
 * and no structured discovery output is verified. Models are therefore supplied
 * by manual model id only; never parse the terminal table as a model catalog.
 */
export const ANTIGRAVITY_MODEL_DISCOVERY_SUPPORT: Readonly<AntigravityModelDiscoverySupport> = Object.freeze({
  available: false,
  reason: 'No structured model discovery is verified; model ids are supplied manually.',
});

/**
 * Namespaces a runtime model id into the provider selection encoding so
 * Antigravity's Gemini models cannot collide with another provider's Gemini
 * models. Idempotent; empty input stays empty.
 */
export function encodeAntigravityModelSelectionId(modelId: string): string {
  const encoded = encodeProviderModelSelectionId(ANTIGRAVITY_PROVIDER_ID, modelId);
  if (!encoded || encoded.startsWith(ANTIGRAVITY_MODEL_PREFIX)) {
    return encoded;
  }

  // The core prefix map is filled in when the provider module registers; keep
  // the namespace guarantee local so saved selections are correct either way.
  return `${ANTIGRAVITY_MODEL_PREFIX}${encoded}`;
}

/**
 * Returns the runtime model id carried by an Antigravity selection, or null
 * when the value belongs to no provider or to another provider's namespace.
 */
export function decodeAntigravityModelSelectionId(value: string): string | null {
  const decoded = decodeProviderModelSelectionId(value);
  if (decoded) {
    return decoded.providerId === ANTIGRAVITY_PROVIDER_ID ? decoded.modelId : null;
  }

  // Fallback for selections saved before the prefix is registered in the core
  // selection map; matches what the core decode returns once it is.
  const trimmed = value.trim();
  if (!trimmed.startsWith(ANTIGRAVITY_MODEL_PREFIX)) {
    return null;
  }

  const modelId = trimmed.slice(ANTIGRAVITY_MODEL_PREFIX.length).trim();
  return modelId || null;
}

/**
 * Default runtime model ID used when none is specified.
 */
export const DEFAULT_ANTIGRAVITY_MODEL_ID = 'gemini-3.8-flash-high';

export interface AntigravityModelDefinition {
  rawId: string;
  label: string;
  description: string;
  isDefault?: boolean;
}

/**
 * Shipped verified default models for Antigravity (agy CLI).
 */
export const DEFAULT_ANTIGRAVITY_MODELS: readonly AntigravityModelDefinition[] = Object.freeze([
  {
    rawId: 'gemini-3.8-flash-high',
    label: 'Gemini 3.8 Flash (High)',
    description: 'Fast, high-capability model with deep reasoning',
    isDefault: true,
  },
  {
    rawId: 'gemini-3.8-flash-medium',
    label: 'Gemini 3.8 Flash (Medium)',
    description: 'Balanced speed and reasoning depth for everyday tasks',
  },
  {
    rawId: 'gemini-3.8-flash-low',
    label: 'Gemini 3.8 Flash (Low)',
    description: 'Fast responses with lighter reasoning',
  },
  {
    rawId: 'gemini-3.7-flash-high',
    label: 'Gemini 3.7 Flash (High)',
    description: 'High-capability reasoning model',
  },
  {
    rawId: 'gemini-3.7-flash-medium',
    label: 'Gemini 3.7 Flash (Medium)',
    description: 'Balanced reasoning model',
  },
  {
    rawId: 'gemini-3.7-flash-low',
    label: 'Gemini 3.7 Flash (Low)',
    description: 'Fast responses with light reasoning',
  },
  {
    rawId: 'gemini-3.6-flash-high',
    label: 'Gemini 3.6 Flash (High)',
    description: 'Previous-generation flash model (high)',
  },
  {
    rawId: 'gemini-3.6-flash-medium',
    label: 'Gemini 3.6 Flash (Medium)',
    description: 'Previous-generation flash model (medium)',
  },
  {
    rawId: 'gemini-3.6-flash-low',
    label: 'Gemini 3.6 Flash (Low)',
    description: 'Previous-generation flash model (low)',
  },
  {
    rawId: 'gemini-3.1-pro-high',
    label: 'Gemini 3.1 Pro (High)',
    description: 'Pro model with extended reasoning depth',
  },
  {
    rawId: 'gemini-3.1-pro-low',
    label: 'Gemini 3.1 Pro (Low)',
    description: 'Fast responses from pro model',
  },
  {
    rawId: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6 (Thinking)',
    description: 'Claude model hosted in Antigravity',
  },
  {
    rawId: 'claude-opus-4-6-thinking',
    label: 'Claude Opus 4.6 (Thinking)',
    description: 'Opus model with thinking in Antigravity',
  },
  {
    rawId: 'gpt-oss-120b-medium',
    label: 'GPT-OSS 120B (Medium)',
    description: 'Open source 120B model in Antigravity',
  },
]);

/**
 * Checks whether a model identifier or name looks like an Antigravity model.
 */
export function looksLikeAntigravityModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith('gemini-') || normalized.startsWith(ANTIGRAVITY_MODEL_PREFIX)) {
    return true;
  }
  return DEFAULT_ANTIGRAVITY_MODELS.some(
    m => m.rawId.toLowerCase() === normalized || m.label.toLowerCase() === normalized,
  );
}

export function isAntigravityModelSelectionId(value: string): boolean {
  return decodeAntigravityModelSelectionId(value) !== null;
}

export function toAntigravityRuntimeModelId(value: string): string {
  const decoded = decodeAntigravityModelSelectionId(value);
  if (decoded) {
    const matched = DEFAULT_ANTIGRAVITY_MODELS.find(
      m => m.label.toLowerCase() === decoded.toLowerCase() || m.rawId.toLowerCase() === decoded.toLowerCase(),
    );
    return matched ? matched.rawId : decoded;
  }

  const trimmed = value.trim();
  const otherDecoded = decodeProviderModelSelectionId(trimmed);
  if (otherDecoded && otherDecoded.providerId !== ANTIGRAVITY_PROVIDER_ID) {
    return trimmed;
  }

  const matched = DEFAULT_ANTIGRAVITY_MODELS.find(
    m => m.label.toLowerCase() === trimmed.toLowerCase() || m.rawId.toLowerCase() === trimmed.toLowerCase(),
  );
  return matched ? matched.rawId : trimmed;
}

export function normalizeAntigravityManualModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

