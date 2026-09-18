import type {
  ProviderConversationHistoryService,
  ProviderConversationSessionAvailability,
} from '../../../core/providers/types';
import { isWriteEditTool } from '../../../core/tools/toolNames';
import type {
  ChatMessage,
  ContentBlock,
  Conversation,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import { extractDiffData } from '../../../utils/diff';
import { readAntigravitySessionState } from '../types';
import {
  type AntigravityHistoryRecord,
  AntigravityHistoryStore,
  buildAntigravityAssistantTextRecord,
  buildAntigravityToolResultRecord,
  buildAntigravityToolUseRecord,
  buildAntigravityUserMessageRecord,
  buildAntigravityUserRecordKey,
} from './AntigravityHistoryStore';

/**
 * Replay cache for Antigravity conversations.
 *
 * The native transcript is an undocumented SQLite/protobuf database under
 * `~/.gemini/antigravity-cli/conversations/` with no official read route
 * (A0 §4), so provider-native import is not available and
 * `supportsNativeHistory` stays false. Replay comes from this provider-owned
 * cache of the events the plugin itself received — a copy of our own live
 * stream, never a claim of native import. Nothing here ever reads or writes
 * the native state home.
 *
 * Two facts are kept separate on purpose:
 * - `AntigravitySessionState.conversationId` says the native session can be
 *   resumed with `--conversation <id>` (only the CLI can actually verify it).
 * - The cache file says which message bodies can be replayed locally.
 * When the cache is missing but a session is bound, history is partial: the
 * bodies stay untouched and resume still targets the bound session. When the
 * native session is lost, stored bodies are preserved and starting a new
 * conversation is the user's choice — a missing transcript is never a reason
 * to delete or reset a conversation, and a replayed turn is never written
 * twice thanks to per-record dedupe keys.
 */

export interface AntigravityTurnStartInput {
  turnIndex: number;
  /** The user prompt that started the turn, stored so replay shows the request. */
  userText: string;
  /** Capture time; defaults to now. */
  timestamp?: number;
}

export interface AntigravityTurnSettledInput {
  turnIndex: number;
  /** Normalized chunks the plugin received for this turn. */
  chunks: StreamChunk[];
  /** Capture time; defaults to now. */
  timestamp?: number;
}

export type AntigravityCacheState = 'ready' | 'missing';

export interface AntigravityHistoryAvailability {
  /** Conversation id bound for `--conversation` resume, when one is bound. */
  nativeConversationId: string | null;
  /** Whether the plugin-owned replay cache file exists. */
  cacheState: AntigravityCacheState;
  /** True when a session is bound but the cache is absent: replay is partial. */
  partialHistory: boolean;
}

interface AssistantTurnAccumulator {
  turnIndex: number;
  timestamp: number;
  textParts: string[];
  contentBlocks: ContentBlock[];
  toolCalls: ToolCallInfo[];
}

export class AntigravityConversationHistoryService implements ProviderConversationHistoryService {
  private readonly store = new AntigravityHistoryStore();
  private hydratedKeys = new Map<string, string>();

  /**
   * Called by the runtime when a turn starts, before any assistant output
   * exists, so the user prompt survives even a crash mid-turn.
   */
  async recordTurnStart(
    conversation: Conversation,
    vaultPath: string | null,
    input: AntigravityTurnStartInput,
  ): Promise<void> {
    if (!input.userText) {
      return;
    }
    const conversationId = this.getBoundConversationId(conversation);
    if (!conversationId) {
      return;
    }
    const timestamp = input.timestamp ?? Date.now();
    await this.store.updateRecords(vaultPath, conversationId, (existing) => {
      const key = buildAntigravityUserRecordKey(conversationId, input.turnIndex);
      if (existing.some(record => record.key === key)) {
        return null;
      }
      return [
        ...existing,
        buildAntigravityUserMessageRecord({
          conversationId,
          turnIndex: input.turnIndex,
          text: input.userText,
          timestamp,
        }),
      ];
    });
  }

  /**
   * Called by the runtime when a turn settles. The turn's replayable records
   * are replaced wholesale with the settled set, so a re-sent or upgraded turn
   * cannot accumulate duplicate fragments.
   */
  async recordTurnSettled(
    conversation: Conversation,
    vaultPath: string | null,
    input: AntigravityTurnSettledInput,
  ): Promise<void> {
    const conversationId = this.getBoundConversationId(conversation);
    if (!conversationId) {
      return;
    }
    const timestamp = input.timestamp ?? Date.now();
    await this.store.updateRecords(vaultPath, conversationId, (existing) => {
      const head: AntigravityHistoryRecord[] = [];
      const tail: AntigravityHistoryRecord[] = [];
      let userRecord: AntigravityHistoryRecord | undefined;
      for (const record of existing) {
        if (record.turnIndex < input.turnIndex) {
          head.push(record);
        } else if (record.turnIndex > input.turnIndex) {
          tail.push(record);
        } else if (!userRecord && record.kind === 'user_message') {
          userRecord = record;
        }
      }
      const settled = buildSettledRecords(conversationId, input.turnIndex, input.chunks, timestamp);
      return [
        ...head,
        ...(userRecord ? [userRecord] : []),
        ...settled,
        ...tail,
      ];
    });
  }

  async hydrateConversationHistory(
    conversation: Conversation,
    vaultPath: string | null,
  ): Promise<void> {
    const conversationId = this.getBoundConversationId(conversation);
    if (!conversationId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const records = await this.store.readRecords(vaultPath, conversationId);
    const hydrationKey = `${conversationId}::${records.length}::${records[records.length - 1]?.key ?? ''}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return;
    }

    const messages = mapAntigravityRecordsToMessages(records);
    if (messages.length === 0) {
      // Cache missing or empty: keep whatever bodies exist so history degrades
      // to partial instead of wiping a conversation whose session still exists.
      this.hydratedKeys.delete(conversation.id);
      return;
    }
    conversation.messages = messages;
    this.hydratedKeys.set(conversation.id, hydrationKey);
  }

  /**
   * Native session availability cannot be verified from the plugin: the only
   * source of truth lives under `~/.gemini/antigravity-cli/`, which the plugin
   * never reads. Only the CLI can confirm or reject a bound conversation id.
   */
  async getConversationSessionAvailability(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<ProviderConversationSessionAvailability> {
    return 'unknown';
  }

  /**
   * A missing transcript is never a reason to delete the conversation. Stored
   * bodies are preserved and the user decides whether to start a new
   * conversation; the previous turn's write operations are never re-run.
   */
  async resolveMissingConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
    _missingProviderSessionId?: string,
  ): Promise<'delete' | 'reset' | 'preserve'> {
    return 'preserve';
  }

  /**
   * Reports both independent facts: whether a native session is bound for
   * resume, and whether local bodies are replayable. The runtime uses this to
   * surface partial history instead of silently re-sending the conversation.
   */
  async describeHistoryAvailability(
    conversation: Conversation,
    vaultPath: string | null,
  ): Promise<AntigravityHistoryAvailability> {
    const conversationId = this.getBoundConversationId(conversation);
    if (!conversationId) {
      return { nativeConversationId: null, cacheState: 'missing', partialHistory: false };
    }
    const cacheState: AntigravityCacheState = (await this.store.cacheFileExists(vaultPath, conversationId))
      ? 'ready'
      : 'missing';
    return { nativeConversationId: conversationId, cacheState, partialHistory: cacheState === 'missing' };
  }

  async deleteConversationSession(
    conversation: Conversation,
    vaultPath: string | null,
  ): Promise<void> {
    const conversationId = this.getBoundConversationId(conversation);
    if (!conversationId) {
      return;
    }
    await this.store.deleteRecords(vaultPath, conversationId);
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    if (!conversation) {
      return null;
    }
    const state = readAntigravitySessionState(conversation);
    const boundId = typeof state?.conversationId === 'string' ? state.conversationId.trim() : '';
    return boundId || conversation.sessionId?.trim() || null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    // Forks are not an Antigravity capability.
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    // Forks are not an Antigravity capability; mirror the other non-fork providers.
    return {};
  }

  private getBoundConversationId(conversation: Conversation): string | null {
    const state = readAntigravitySessionState(conversation);
    const boundId = typeof state?.conversationId === 'string' ? state.conversationId.trim() : '';
    return boundId || conversation.sessionId?.trim() || null;
  }
}

/**
 * Converts settled stream chunks into cache records, preserving the order the
 * plugin received: every non-empty text fragment keeps its position relative
 * to tool activity. Usage, notices, and done markers are turn metadata, not
 * message bodies, and are not replayed.
 */
function buildSettledRecords(
  conversationId: string,
  turnIndex: number,
  chunks: StreamChunk[],
  timestamp: number,
): AntigravityHistoryRecord[] {
  const records: AntigravityHistoryRecord[] = [];
  let textOrdinal = 0;
  for (const chunk of chunks) {
    if (chunk.type === 'text') {
      if (chunk.content) {
        records.push(buildAntigravityAssistantTextRecord({
          conversationId,
          turnIndex,
          ordinal: textOrdinal,
          text: chunk.content,
          timestamp,
        }));
        textOrdinal += 1;
      }
      continue;
    }
    if (chunk.type === 'tool_use') {
      records.push(buildAntigravityToolUseRecord({
        conversationId,
        turnIndex,
        toolId: chunk.id,
        toolName: chunk.name,
        input: chunk.input,
        timestamp,
      }));
      continue;
    }
    if (chunk.type === 'tool_result') {
      records.push(buildAntigravityToolResultRecord({
        conversationId,
        turnIndex,
        toolId: chunk.id,
        content: chunk.content,
        isError: chunk.isError === true,
        ...(isRecord(chunk.toolUseResult) ? { toolUseResult: chunk.toolUseResult } : {}),
        timestamp,
      }));
    }
  }
  return records;
}

/**
 * Rebuilds chat messages from cache records. Records are line-ordered and
 * already deduped; each turn becomes one user message (when recorded) and one
 * assistant message combining text fragments and tool activity in stream
 * order. A tool_use whose result was lost stays `running`; a result without
 * its tool_use is dropped rather than guessed.
 */
export function mapAntigravityRecordsToMessages(records: AntigravityHistoryRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let current: AssistantTurnAccumulator | null = null;

  for (const record of records) {
    if (record.kind === 'user_message') {
      if (current) {
        messages.push(buildAssistantMessage(current));
        current = null;
      }
      messages.push({
        content: record.text,
        id: `antigravity-user-${record.turnIndex}`,
        role: 'user',
        timestamp: record.timestamp,
      });
      continue;
    }

    if (!current || current.turnIndex !== record.turnIndex) {
      if (current) {
        messages.push(buildAssistantMessage(current));
      }
      current = {
        turnIndex: record.turnIndex,
        timestamp: record.timestamp,
        textParts: [],
        contentBlocks: [],
        toolCalls: [],
      };
    }

    if (record.kind === 'assistant_text') {
      current.textParts.push(record.text);
      current.contentBlocks.push({ type: 'text', content: record.text });
      continue;
    }
    if (record.kind === 'tool_use') {
      current.contentBlocks.push({ type: 'tool_use', toolId: record.toolId });
      current.toolCalls.push({
        id: record.toolId,
        input: record.input,
        name: record.toolName,
        status: 'running',
      });
      continue;
    }
    if (record.kind === 'tool_result') {
      const toolCall = [...current.toolCalls].reverse().find(call => call.id === record.toolId);
      if (!toolCall) {
        continue;
      }
      toolCall.status = record.isError ? 'error' : 'completed';
      toolCall.result = record.content;
      if (!record.isError && isWriteEditTool(toolCall.name)) {
        const diffData = extractDiffData(record.toolUseResult ?? {}, toolCall);
        if (diffData) {
          toolCall.diffData = diffData;
        }
      }
    }
  }

  if (current) {
    messages.push(buildAssistantMessage(current));
  }
  return messages;
}

function buildAssistantMessage(accumulator: AssistantTurnAccumulator): ChatMessage {
  const message: ChatMessage = {
    content: accumulator.textParts.join(''),
    id: `antigravity-assistant-${accumulator.turnIndex}`,
    role: 'assistant',
    timestamp: accumulator.timestamp,
  };
  if (accumulator.contentBlocks.length > 0) {
    message.contentBlocks = accumulator.contentBlocks;
  }
  if (accumulator.toolCalls.length > 0) {
    message.toolCalls = accumulator.toolCalls;
  }
  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
