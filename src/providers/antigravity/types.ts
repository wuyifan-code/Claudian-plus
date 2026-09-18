import type { ProviderCapabilities } from '../../core/providers/types';
import type { Conversation } from '../../core/types';

/**
 * Persisted Antigravity session binding stored inside `Conversation.providerState`.
 *
 * The plugin never invents CLI protocol fields here: `conversationId` is the real
 * conversation id echoed by the CLI's own `init`/`result` events (A0-verified),
 * and `turnCount` is plugin-side accounting of settled successful turns (it is
 * intentionally NOT presented as the CLI's cumulative `num_turns`, which the
 * plugin does not re-derive outside the normalization layer).
 */
export interface AntigravitySessionState {
  schemaVersion: number;
  conversationId: string;
  turnCount: number;
}

export const ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION = 1;

const ANTIGRAVITY_SESSION_STATE_KEY = 'antigravitySession';

/**
 * Reads the Antigravity session binding from a conversation. Returns `null` for
 * missing, foreign-provider, legacy, or future-schema data; it never throws and
 * never fabricates defaults, so callers can distinguish "no verified session"
 * from a resumable one.
 */
export function readAntigravitySessionState(
  conversation: Conversation | null,
): AntigravitySessionState | null {
  const bag = conversation?.providerState;
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) {
    return null;
  }
  const entry: unknown = bag[ANTIGRAVITY_SESSION_STATE_KEY];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  if (record.schemaVersion !== ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION) {
    return null;
  }
  if (typeof record.conversationId !== 'string' || record.conversationId.length === 0) {
    return null;
  }
  if (
    typeof record.turnCount !== 'number'
    || !Number.isInteger(record.turnCount)
    || record.turnCount < 0
  ) {
    return null;
  }
  return {
    schemaVersion: record.schemaVersion,
    conversationId: record.conversationId,
    turnCount: record.turnCount,
  };
}

/**
 * Merges the Antigravity session binding into the conversation's provider-owned
 * state bag, preserving every unrelated provider key. This is the only write
 * path for Antigravity session state; it throws on malformed input instead of
 * persisting garbage, and returns the updated bag (also assigned back onto the
 * conversation) so callers can persist it.
 */
export function writeAntigravitySessionState(
  conversation: Conversation,
  next: AntigravitySessionState,
): Conversation['providerState'] {
  if (!conversation || typeof conversation !== 'object') {
    throw new RangeError('writeAntigravitySessionState: conversation is required');
  }
  if (typeof next?.conversationId !== 'string' || next.conversationId.trim().length === 0) {
    throw new RangeError('writeAntigravitySessionState: conversationId is required');
  }
  if (
    typeof next.turnCount !== 'number'
    || !Number.isInteger(next.turnCount)
    || next.turnCount < 0
  ) {
    throw new RangeError('writeAntigravitySessionState: turnCount must be a non-negative integer');
  }

  const entry: AntigravitySessionState = {
    schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
    conversationId: next.conversationId,
    turnCount: next.turnCount,
  };
  const bag: NonNullable<Conversation['providerState']> = {
    ...conversation.providerState,
    [ANTIGRAVITY_SESSION_STATE_KEY]: entry,
  };
  conversation.providerState = bag;
  return bag;
}

/**
 * Conservative capability truth for the Antigravity provider (A0, 2026-09-18).
 *
 * - `supportsPersistentRuntime: false` — multi-turn stdin emission is docs-only;
 *   only the per-turn print mode is verified end-to-end.
 * - `supportsNativeHistory: false` — native transcripts are an undocumented
 *   SQLite/protobuf format with no official read route (A0 §4).
 * - No ACP reuse and no plan/fork/rewind/images/commands/MCP/steer support:
 *   none of those chains are verified; flag existence in `agy --help` is not a
 *   plugin capability.
 *
 * The registration/UI task (A5b) owns the shipped capabilities file; it must
 * keep these values until fresh protocol evidence lands.
 */
export const ANTIGRAVITY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'antigravity',
  supportsPersistentRuntime: false,
  supportsNativeHistory: false,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: false,
  supportsImageAttachments: false,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsSharedAgentSkills: false,
  supportsTurnSteer: false,
  reasoningControl: 'none',
});
