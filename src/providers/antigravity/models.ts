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

export function isAntigravityModelSelectionId(value: string): boolean {
  return decodeAntigravityModelSelectionId(value) !== null;
}

export function toAntigravityRuntimeModelId(value: string): string {
  return decodeAntigravityModelSelectionId(value) ?? value;
}

export function normalizeAntigravityManualModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
