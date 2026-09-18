import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Conversation, StreamChunk } from '@/core/types';
import { AntigravityConversationHistoryService } from '@/providers/antigravity/history/AntigravityConversationHistoryService';
import {
  AntigravityHistoryPathError,
  AntigravityHistoryStore,
  resolveAntigravityCacheFile,
} from '@/providers/antigravity/history/AntigravityHistoryStore';
import { buildAntigravityToolKey } from '@/providers/antigravity/normalizations/antigravityToolNormalization';
import {
  type AntigravitySessionState,
  writeAntigravitySessionState,
} from '@/providers/antigravity/types';

const CONVERSATION_ID = 'e848aee0-1111-2222-3333-444444444444';

function makeVaultPath(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-history-service-'));
}

function createConversation(sessionId: string | null): Conversation {
  return {
    id: 'conversation-1',
    providerId: 'antigravity',
    title: 'Antigravity replay',
    createdAt: 1000,
    updatedAt: 1000,
    sessionId,
    messages: [],
  };
}

function bindSession(conversation: Conversation, conversationId: string, turnCount: number): void {
  const next: AntigravitySessionState = {
    schemaVersion: 1,
    conversationId,
    turnCount,
  };
  writeAntigravitySessionState(conversation, next);
}

function textChunk(content: string): StreamChunk {
  return { type: 'text', content };
}

async function cacheRecordCount(vaultPath: string, conversationId: string): Promise<number> {
  const store = new AntigravityHistoryStore();
  return (await store.readRecords(vaultPath, conversationId)).length;
}

describe('AntigravityConversationHistoryService replay', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = makeVaultPath();
  });

  afterEach(async () => {
    await fsp.rm(vaultPath, { recursive: true, force: true });
  });

  it('replays user text, assistant text and tool activity in order after a restart', async () => {
    const writer = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 2);
    const toolKey = buildAntigravityToolKey({ conversationId: CONVERSATION_ID, turnIndex: 0, stepIndex: 1 });

    await writer.recordTurnStart(conversation, vaultPath, {
      turnIndex: 0,
      userText: 'Fix the bug',
      timestamp: 1000,
    });
    await writer.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 0,
      timestamp: 1100,
      chunks: [
        { type: 'tool_use', id: toolKey, name: 'Bash', input: { command: 'npm test' } },
        {
          type: 'tool_result',
          id: toolKey,
          content: '3 passed',
          isError: false,
          toolUseResult: { name: 'Bash', parameters: {}, output: '3 passed', error: null },
        },
        textChunk('All tests pass.'),
        { type: 'notice', content: 'ignored, not a message body', level: 'info' },
        { type: 'done' },
      ] satisfies StreamChunk[],
    });
    await writer.recordTurnStart(conversation, vaultPath, {
      turnIndex: 1,
      userText: 'Thanks',
      timestamp: 2000,
    });
    await writer.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 1,
      timestamp: 2100,
      chunks: [textChunk('Anytime.')],
    });

    const reader = new AntigravityConversationHistoryService();
    const reopened = createConversation(CONVERSATION_ID);
    bindSession(reopened, CONVERSATION_ID, 2);
    await reader.hydrateConversationHistory(reopened, vaultPath);

    expect(reopened.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Fix the bug'],
      ['assistant', 'All tests pass.'],
      ['user', 'Thanks'],
      ['assistant', 'Anytime.'],
    ]);

    const assistantWithTool = reopened.messages[1];
    expect(assistantWithTool.toolCalls).toEqual([
      {
        id: toolKey,
        name: 'Bash',
        input: { command: 'npm test' },
        status: 'completed',
        result: '3 passed',
      },
    ]);
    expect(assistantWithTool.contentBlocks?.map(block => block.type)).toEqual(['tool_use', 'text']);
  });

  it('keeps the same session id for continued turns after replay', async () => {
    const writer = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 1);
    await writer.recordTurnStart(conversation, vaultPath, {
      turnIndex: 0,
      userText: 'hello',
      timestamp: 1,
    });
    await writer.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 0,
      timestamp: 2,
      chunks: [textChunk('hi')],
    });

    const reader = new AntigravityConversationHistoryService();
    const reopened = createConversation(CONVERSATION_ID);
    bindSession(reopened, CONVERSATION_ID, 1);
    await reader.hydrateConversationHistory(reopened, vaultPath);

    expect(reader.resolveSessionIdForConversation(reopened)).toBe(CONVERSATION_ID);
    expect(reopened.sessionId).toBe(CONVERSATION_ID);
    expect(reopened.providerState).toBeDefined();
  });

  it('still replays earlier turns when the cache ends with a half-written line', async () => {
    const writer = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 1);
    await writer.recordTurnStart(conversation, vaultPath, {
      turnIndex: 0,
      userText: 'survives the crash',
      timestamp: 1,
    });
    await writer.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 0,
      timestamp: 2,
      chunks: [textChunk('kept body')],
    });

    const cacheFile = resolveAntigravityCacheFile(vaultPath, CONVERSATION_ID);
    if (!cacheFile) {
      throw new Error('cache file path unexpectedly null');
    }
    await fsp.appendFile(cacheFile, '{"v":1,"provider":"antigravity","kind":"assistant_te', 'utf-8');

    const reader = new AntigravityConversationHistoryService();
    const reopened = createConversation(CONVERSATION_ID);
    bindSession(reopened, CONVERSATION_ID, 1);
    await reader.hydrateConversationHistory(reopened, vaultPath);

    expect(reopened.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'survives the crash'],
      ['assistant', 'kept body'],
    ]);
  });

  it('treats a missing cache file as partial history and never throws', async () => {
    const reader = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 3);

    await expect(reader.hydrateConversationHistory(conversation, vaultPath)).resolves.toBeUndefined();
    expect(conversation.messages).toEqual([]);

    await expect(reader.describeHistoryAvailability(conversation, vaultPath)).resolves.toEqual({
      nativeConversationId: CONVERSATION_ID,
      cacheState: 'missing',
      partialHistory: true,
    });
  });

  it('keeps stored bodies when the cache disappears after a previous replay', async () => {
    const service = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 1);
    await service.recordTurnStart(conversation, vaultPath, {
      turnIndex: 0,
      userText: 'first',
      timestamp: 1,
    });
    await service.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 0,
      timestamp: 2,
      chunks: [textChunk('body')],
    });
    await service.hydrateConversationHistory(conversation, vaultPath);
    expect(conversation.messages).toHaveLength(2);

    await service.deleteConversationSession(conversation, vaultPath);
    await service.hydrateConversationHistory(conversation, vaultPath);

    expect(conversation.messages.map(message => message.content)).toEqual(['first', 'body']);
    const availability = await service.describeHistoryAvailability(conversation, vaultPath);
    expect(availability.partialHistory).toBe(true);
  });

  it('hydrates around unknown record schemas and foreign provider data without throwing', async () => {
    const cacheFile = resolveAntigravityCacheFile(vaultPath, CONVERSATION_ID);
    if (!cacheFile) {
      throw new Error('cache file path unexpectedly null');
    }
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    const validUser = {
      v: 1,
      provider: 'antigravity',
      kind: 'user_message',
      key: `agy:${CONVERSATION_ID}:turn0:user`,
      conversationId: CONVERSATION_ID,
      turnIndex: 0,
      timestamp: 1,
      text: 'usable turn',
    };
    const foreign = {
      v: 1,
      provider: 'codex',
      kind: 'user_message',
      key: 'codex-key',
      conversationId: CONVERSATION_ID,
      turnIndex: 1,
      timestamp: 2,
      text: 'foreign provider data',
    };
    const unknownSchema = {
      v: 7,
      provider: 'antigravity',
      kind: 'user_message',
      key: 'future-key',
      conversationId: CONVERSATION_ID,
      turnIndex: 2,
      timestamp: 3,
      text: 'future schema',
    };
    await fsp.writeFile(
      cacheFile,
      `${JSON.stringify(foreign)}\n${JSON.stringify(unknownSchema)}\n${JSON.stringify(validUser)}\n`,
      'utf-8',
    );

    const reader = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 3);
    await expect(reader.hydrateConversationHistory(conversation, vaultPath)).resolves.toBeUndefined();

    expect(conversation.messages.map(message => message.content)).toEqual(['usable turn']);
  });

  it('rejects path traversal outside the configured cache root', async () => {
    const service = new AntigravityConversationHistoryService();
    const hostile = createConversation(null);
    bindSession(hostile, '../escape', 1);

    await expect(service.hydrateConversationHistory(hostile, vaultPath)).rejects.toBeInstanceOf(
      AntigravityHistoryPathError,
    );
    await expect(
      service.recordTurnStart(hostile, vaultPath, { turnIndex: 0, userText: 'x', timestamp: 1 }),
    ).rejects.toBeInstanceOf(AntigravityHistoryPathError);
    await expect(
      service.recordTurnSettled(hostile, vaultPath, { turnIndex: 0, timestamp: 1, chunks: [] }),
    ).rejects.toBeInstanceOf(AntigravityHistoryPathError);
    await expect(service.deleteConversationSession(hostile, vaultPath)).rejects.toBeInstanceOf(
      AntigravityHistoryPathError,
    );
  });

  it('never resolves a missing transcript as a deletable conversation', async () => {
    const service = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 4);

    await expect(
      service.resolveMissingConversationSession(conversation, vaultPath, CONVERSATION_ID),
    ).resolves.toBe('preserve');
    await expect(
      service.resolveMissingConversationSession(conversation, null, CONVERSATION_ID),
    ).resolves.toBe('preserve');
  });

  it('reports native session availability as unknown because native state is never inspected', async () => {
    const service = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 1);

    await expect(
      service.getConversationSessionAvailability!(conversation, vaultPath),
    ).resolves.toBe('unknown');
  });

  it('is idempotent: a replayed turn is never written twice', async () => {
    const service = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 1);

    await service.recordTurnStart(conversation, vaultPath, { turnIndex: 0, userText: 'dup', timestamp: 1 });
    await service.recordTurnStart(conversation, vaultPath, { turnIndex: 0, userText: 'dup', timestamp: 2 });
    expect(await cacheRecordCount(vaultPath, CONVERSATION_ID)).toBe(1);

    await service.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 0,
      timestamp: 3,
      chunks: [textChunk('Hel')],
    });
    await service.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 0,
      timestamp: 3,
      chunks: [textChunk('Hel')],
    });
    expect(await cacheRecordCount(vaultPath, CONVERSATION_ID)).toBe(2);

    await service.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 0,
      timestamp: 4,
      chunks: [textChunk('Hello complete')],
    });
    const store = new AntigravityHistoryStore();
    const records = await store.readRecords(vaultPath, CONVERSATION_ID);
    expect(records).toHaveLength(2);
    const assistantRecords = records.filter(record => record.kind === 'assistant_text');
    expect(assistantRecords).toHaveLength(1);
    expect(assistantRecords[0]).toMatchObject({ text: 'Hello complete' });
  });

  it('rewrites an unsettled turn in place when a later turn settles out of order', async () => {
    const service = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 3);

    await service.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 2,
      timestamp: 30,
      chunks: [textChunk('turn two')],
    });
    await service.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 0,
      timestamp: 10,
      chunks: [textChunk('turn zero')],
    });
    await service.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 1,
      timestamp: 20,
      chunks: [textChunk('turn one')],
    });

    const reader = new AntigravityConversationHistoryService();
    const reopened = createConversation(CONVERSATION_ID);
    bindSession(reopened, CONVERSATION_ID, 3);
    await reader.hydrateConversationHistory(reopened, vaultPath);

    expect(reopened.messages.map(message => message.content)).toEqual([
      'turn zero',
      'turn one',
      'turn two',
    ]);
  });

  it('does not duplicate messages when hydration runs twice and picks up new turns', async () => {
    const service = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 1);
    await service.recordTurnStart(conversation, vaultPath, { turnIndex: 0, userText: 'q', timestamp: 1 });
    await service.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 0,
      timestamp: 2,
      chunks: [textChunk('a')],
    });

    await service.hydrateConversationHistory(conversation, vaultPath);
    await service.hydrateConversationHistory(conversation, vaultPath);
    expect(conversation.messages).toHaveLength(2);

    await service.recordTurnStart(conversation, vaultPath, { turnIndex: 1, userText: 'q2', timestamp: 3 });
    await service.recordTurnSettled(conversation, vaultPath, {
      turnIndex: 1,
      timestamp: 4,
      chunks: [textChunk('a2')],
    });
    await service.hydrateConversationHistory(conversation, vaultPath);

    expect(conversation.messages.map(message => message.content)).toEqual(['q', 'a', 'q2', 'a2']);
  });

  it('skips hydration for conversations that were never bound to a native session', async () => {
    const service = new AntigravityConversationHistoryService();
    const conversation = createConversation(null);

    await expect(service.hydrateConversationHistory(conversation, vaultPath)).resolves.toBeUndefined();
    expect(conversation.messages).toEqual([]);
    expect(await service.describeHistoryAvailability(conversation, vaultPath)).toEqual({
      nativeConversationId: null,
      cacheState: 'missing',
      partialHistory: false,
    });
  });

  it('deletes only the plugin-owned cache file when the conversation is deleted', async () => {
    const service = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);
    bindSession(conversation, CONVERSATION_ID, 1);
    await service.recordTurnStart(conversation, vaultPath, { turnIndex: 0, userText: 'x', timestamp: 1 });

    const store = new AntigravityHistoryStore();
    expect(await store.cacheFileExists(vaultPath, CONVERSATION_ID)).toBe(true);
    await service.deleteConversationSession(conversation, vaultPath);
    expect(await store.cacheFileExists(vaultPath, CONVERSATION_ID)).toBe(false);

    const unbound = createConversation(null);
    await expect(service.deleteConversationSession(unbound, vaultPath)).resolves.toBeUndefined();
  });

  it('reports fork support as absent like other non-fork providers', () => {
    const service = new AntigravityConversationHistoryService();
    const conversation = createConversation(CONVERSATION_ID);

    expect(service.isPendingForkConversation(conversation)).toBe(false);
    expect(service.buildForkProviderState('source', 'resume-at')).toEqual({});
    expect(service.resolveSessionIdForConversation(null)).toBeNull();
  });
});
