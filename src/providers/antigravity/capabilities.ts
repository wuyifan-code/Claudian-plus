import type { ProviderCapabilities } from '../../core/providers/types';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from './types';

/**
 * Capabilities the shipped Antigravity provider module registers.
 *
 * The constant itself lives in `types.ts` so the runtime, the settings UI, and
 * the registration all read one frozen object instead of three copies that can
 * drift. It stays conservative until fresh protocol evidence exists: only
 * per-turn print mode is verified end-to-end (A0, 2026-09-18,
 * `.context/antigravity/compatibility.md`), so persistent runtime, native
 * history, plan mode, rewind, fork, provider commands, images, instruction mode,
 * MCP, shared skills, turn steering, and reasoning control are all reported as
 * absent. Flag existence in `agy --help` is not a plugin capability.
 */
export const antigravityProviderCapabilities: Readonly<ProviderCapabilities> =
  ANTIGRAVITY_PROVIDER_CAPABILITIES;
