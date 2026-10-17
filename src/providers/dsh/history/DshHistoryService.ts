import type { ProviderConversationHistoryService, ProviderConversationSessionAvailability } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types/chat';
import { isDshObject, mapDshRecordsToMessages, readDshEvent } from '../normalization/dshRecords';

export interface DshHistorySnapshot {
  cursor: number;
  records: unknown[];
  hasMore: boolean;
  header?: unknown;
}

export interface DshHistoryReader {
  readonly home: string;
  readonly preset?: string;
  call<T>(method: string, args?: unknown, lookup?: unknown, signal?: AbortSignal): Promise<T>;
  snapshot(sessionId: string, signal?: AbortSignal): Promise<DshHistorySnapshot>;
}

interface NativeBinding {
  home: string;
  preset?: string;
}

function bindingFor(conversation: Conversation): NativeBinding | null {
  const state = conversation.providerState;
  if (conversation.providerId !== 'dsh' || !conversation.sessionId || !state
    || state.schemaVersion !== 1 || state.backend !== 'native'
    || typeof state.home !== 'string' || !state.home.trim()
    || (state.preset !== undefined && typeof state.preset !== 'string')) return null;
  return { home: state.home, preset: state.preset };
}

export function normalizeDshHistoryHome(home: string): string {
  const normalized = home.replace(/\\/g, '/');
  const trimmed = normalized.replace(/\/+$/, '');
  return /^[a-z]:\/|^\/\//i.test(normalized) ? trimmed.toLowerCase() : trimmed;
}

function validatePage(value: unknown, throughSeq: number, beforeSeq: number): { records: unknown[]; hasMore: boolean; firstSeq: number } {
  if (!isDshObject(value) || !Array.isArray(value.records) || typeof value.hasMore !== 'boolean') {
    throw new Error('Malformed DeepSeek history page.');
  }
  let firstSeq = beforeSeq;
  let prior = -1;
  for (const record of value.records) {
    const event = readDshEvent(record);
    if (!event || event.seq > throughSeq || event.seq >= beforeSeq || event.seq <= prior) {
      throw new Error('DeepSeek history page is outside the fixed snapshot cursor or is not ordered.');
    }
    firstSeq = Math.min(firstSeq, event.seq);
    prior = event.seq;
  }
  if (value.hasMore && firstSeq >= beforeSeq) throw new Error('DeepSeek history pagination made no progress.');
  return { records: value.records, hasMore: value.hasMore, firstSeq };
}

/** Reads official native history without modifying native files or invalidating legacy state. */
export class DshHistoryService implements ProviderConversationHistoryService {
  constructor(private readonly resolveReader: (vaultPath: string | null) => Promise<DshHistoryReader>) {}

  private async readerFor(conversation: Conversation, vaultPath: string | null): Promise<DshHistoryReader | null> {
    const binding = bindingFor(conversation);
    if (!binding) return null;
    const reader = await this.resolveReader(vaultPath);
    if (normalizeDshHistoryHome(reader.home) !== normalizeDshHistoryHome(binding.home) || reader.preset !== binding.preset) {
      throw new Error('DeepSeek history belongs to a different native home or agent preset. Restore the saved binding to read it.');
    }
    return reader;
  }

  async hydrateConversationHistory(conversation: Conversation, vaultPath: string | null): Promise<void> {
    const originalSessionId = conversation.sessionId;
    const originalMessages = conversation.messages;
    const originalMessageCount = originalMessages.length;
    const reader = await this.readerFor(conversation, vaultPath);
    const sessionId = conversation.sessionId;
    if (!reader || !sessionId) return;
    if (sessionId !== originalSessionId) throw new Error('DeepSeek conversation changed while loading history.');
    const snapshot = await reader.snapshot(sessionId);
    if (!Number.isSafeInteger(snapshot.cursor) || snapshot.cursor < -1) throw new Error('Malformed DeepSeek snapshot cursor.');
    if (isDshObject(snapshot.header) && snapshot.header.id !== sessionId) throw new Error('DeepSeek snapshot returned a different native session.');
    const throughSeq = snapshot.cursor;
    let page = validatePage(snapshot, throughSeq, throughSeq + 1);
    const records = [...page.records];
    let pageCount = 0;
    while (page.hasMore) {
      if (++pageCount > 10000) throw new Error('DeepSeek history exceeded the supported pagination limit.');
      const value = await reader.call<unknown>('session/page', {
        request: { address: { kind: 'session', sessionId }, throughSeq, beforeSeq: page.firstSeq, maxMessages: 100 },
      });
      page = validatePage(value, throughSeq, page.firstSeq);
      records.push(...page.records);
    }
    const ordered = records.map(readDshEvent).filter(event => event !== null).sort((left, right) => left.seq - right.seq);
    if (ordered.length !== throughSeq + 1 || ordered.some((event, index) => event.seq !== index)) {
      throw new Error('DeepSeek history is incomplete at the opening snapshot cursor.');
    }
    const messages = mapDshRecordsToMessages(records);
    const binding = bindingFor(conversation);
    if (conversation.sessionId !== originalSessionId || !binding || normalizeDshHistoryHome(binding.home) !== normalizeDshHistoryHome(reader.home)
      || binding.preset !== reader.preset || conversation.messages !== originalMessages || conversation.messages.length !== originalMessageCount) {
      throw new Error('DeepSeek conversation changed while loading history.');
    }
    conversation.messages = messages;
  }

  async getConversationSessionAvailability(conversation: Conversation, vaultPath: string | null): Promise<ProviderConversationSessionAvailability> {
    try {
      const reader = await this.readerFor(conversation, vaultPath);
      if (!reader || !conversation.sessionId) return 'unknown';
      const projection = await reader.call<unknown>('session/projections', { request: { sessionId: conversation.sessionId } });
      return projection === null ? 'missing' : isDshObject(projection) ? 'available' : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async resolveMissingConversationSession(_conversation: Conversation, _vaultPath: string | null): Promise<'preserve'> {
    return 'preserve';
  }

  async deleteConversationSession(_conversation: Conversation, _vaultPath: string | null): Promise<void> {
    // Removing a local UI conversation never deletes provider-native history.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation && bindingFor(conversation) ? conversation.sessionId : null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(_sourceSessionId: string, _resumeAt: string, _sourceProviderState?: Record<string, unknown>): Record<string, unknown> {
    throw new Error('DeepSeek native session forks are not supported.');
  }
}
