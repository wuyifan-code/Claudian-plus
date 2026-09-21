import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  AntigravityHistoryPathError,
  AntigravityHistoryStore,
  buildAntigravityAssistantTextRecord,
  buildAntigravityCacheFileName,
  buildAntigravityToolResultRecord,
  buildAntigravityToolUseRecord,
  buildAntigravityUserMessageRecord,
  parseAntigravityHistoryContent,
  resolveAntigravityCacheFile,
  resolveAntigravityCacheRoot,
} from '@/providers/antigravity/history/AntigravityHistoryStore';

const CONVERSATION_ID = 'e848aee0-1111-2222-3333-444444444444';

interface RenameState {
  impl: (...args: unknown[]) => Promise<void>;
}

const renameState: RenameState = {
  impl: (...args: unknown[]) => (fsp.rename as (...renameArgs: unknown[]) => Promise<void>)(...args),
};

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual('node:fs/promises');
  return {
    ...actual,
    rename: (...args: unknown[]) => renameState.impl(...args),
  };
});

const actualRename: (...args: unknown[]) => Promise<void> = jest.requireActual('node:fs/promises').rename;

function makeVaultPath(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-history-'));
}

async function writeCacheFileRaw(vaultPath: string, conversationId: string, content: string): Promise<string> {
  const filePath = resolveAntigravityCacheFile(vaultPath, conversationId);
  if (!filePath) {
    throw new Error('cache file path unexpectedly null in test setup');
  }
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('AntigravityHistoryStore path resolution', () => {
  it('resolves the cache file inside the vault-relative antigravity sessions root', () => {
    const vaultPath = path.resolve('vaults', 'demo');
    const root = resolveAntigravityCacheRoot(vaultPath);
    expect(root).toBe(path.join(vaultPath, '.claudian-plus', 'providers', 'antigravity', 'sessions'));

    const filePath = resolveAntigravityCacheFile(vaultPath, CONVERSATION_ID);
    expect(filePath).toBe(path.join(root!, `${CONVERSATION_ID}.jsonl`));
  });

  it('returns a null cache file when no vault path is configured', () => {
    expect(resolveAntigravityCacheRoot(null)).toBeNull();
    expect(resolveAntigravityCacheRoot('   ')).toBeNull();
    expect(resolveAntigravityCacheFile(null, CONVERSATION_ID)).toBeNull();
  });

  it.each([
    '../escape',
    '..\\escape',
    'a/b',
    'a\\b',
    '..',
    '.',
    '',
    '   ',
    'C:\\evil',
    '/abs/evil',
    '.hidden',
    'id with space',
  ])('rejects the hostile conversation id %j', (conversationId) => {
    expect(() => buildAntigravityCacheFileName(conversationId)).toThrow(AntigravityHistoryPathError);
    expect(() => resolveAntigravityCacheFile(path.resolve('vaults', 'demo'), conversationId)).toThrow(
      AntigravityHistoryPathError,
    );
  });

  it('rejects a relative vault path', () => {
    expect(() => resolveAntigravityCacheFile('relative/vault', CONVERSATION_ID)).toThrow(
      AntigravityHistoryPathError,
    );
  });
});

describe('AntigravityHistoryStore record codec', () => {
  it('round-trips every record kind through serialize and parse', () => {
    const records = [
      buildAntigravityUserMessageRecord({
        conversationId: CONVERSATION_ID,
        turnIndex: 0,
        text: 'Fix the bug',
        timestamp: 1000,
      }),
      buildAntigravityToolUseRecord({
        conversationId: CONVERSATION_ID,
        turnIndex: 0,
        toolId: `agy:${CONVERSATION_ID}:turn0:step1`,
        toolName: 'Bash',
        input: { command: 'npm test' },
        timestamp: 1010,
      }),
      buildAntigravityToolResultRecord({
        conversationId: CONVERSATION_ID,
        turnIndex: 0,
        toolId: `agy:${CONVERSATION_ID}:turn0:step1`,
        content: 'ok',
        isError: false,
        toolUseResult: { name: 'Bash', parameters: {}, output: 'ok', error: null },
        timestamp: 1020,
      }),
      buildAntigravityAssistantTextRecord({
        conversationId: CONVERSATION_ID,
        turnIndex: 0,
        ordinal: 0,
        text: 'All tests pass.',
        timestamp: 1030,
      }),
    ];

    const content = records.map(record => JSON.stringify(record)).join('\n') + '\n';
    expect(parseAntigravityHistoryContent(content)).toEqual(records);
  });

  it('keeps valid records and ignores a half-written trailing line', () => {
    const kept = [
      buildAntigravityUserMessageRecord({
        conversationId: CONVERSATION_ID,
        turnIndex: 0,
        text: 'first',
        timestamp: 1,
      }),
      buildAntigravityAssistantTextRecord({
        conversationId: CONVERSATION_ID,
        turnIndex: 0,
        ordinal: 0,
        text: 'second',
        timestamp: 2,
      }),
    ];
    const content = `${kept.map(record => JSON.stringify(record)).join('\n')}\n{"v":1,"provider":"antigravity","kind":"ass`;
    expect(parseAntigravityHistoryContent(content)).toEqual(kept);
  });

  it('parses CRLF content and tolerates blank lines', () => {
    const record = buildAntigravityUserMessageRecord({
      conversationId: CONVERSATION_ID,
      turnIndex: 3,
      text: 'crlf',
      timestamp: 5,
    });
    const content = `\r\n${JSON.stringify(record)}\r\n\r\n`;
    expect(parseAntigravityHistoryContent(content)).toEqual([record]);
  });

  it('skips records with an unknown schema version or unknown kind without throwing', () => {
    const valid = buildAntigravityUserMessageRecord({
      conversationId: CONVERSATION_ID,
      turnIndex: 0,
      text: 'valid',
      timestamp: 1,
    });
    const futureVersion = { ...valid, v: 99, key: 'future' };
    const unknownKind = { ...valid, kind: 'hologram', key: 'unknown-kind' };
    const missingFields = { v: 1, provider: 'antigravity', kind: 'user_message' };
    const content = [
      JSON.stringify(futureVersion),
      JSON.stringify(unknownKind),
      JSON.stringify(missingFields),
      JSON.stringify(valid),
      'not json at all',
      '',
    ].join('\n');

    expect(parseAntigravityHistoryContent(content)).toEqual([valid]);
  });

  it('skips records written by a foreign provider', () => {
    const foreign = {
      v: 1,
      provider: 'codex',
      kind: 'user_message',
      key: 'codex-key',
      conversationId: CONVERSATION_ID,
      turnIndex: 0,
      timestamp: 1,
      text: 'from codex',
    };
    const valid = buildAntigravityUserMessageRecord({
      conversationId: CONVERSATION_ID,
      turnIndex: 0,
      text: 'ours',
      timestamp: 2,
    });
    const content = `${JSON.stringify(foreign)}\n${JSON.stringify(valid)}\n`;
    expect(parseAntigravityHistoryContent(content)).toEqual([valid]);
  });

  it('deduplicates records by key keeping the first occurrence', () => {
    const first = buildAntigravityUserMessageRecord({
      conversationId: CONVERSATION_ID,
      turnIndex: 0,
      text: 'first',
      timestamp: 1,
    });
    const duplicate = { ...first, text: 'second' };
    const content = `${JSON.stringify(first)}\n${JSON.stringify(duplicate)}\n`;
    expect(parseAntigravityHistoryContent(content)).toEqual([first]);
  });
});

describe('AntigravityHistoryStore writes', () => {
  let vaultPath: string;

  beforeEach(() => {
    renameState.impl = actualRename;
    vaultPath = makeVaultPath();
  });

  afterEach(async () => {
    await fsp.rm(vaultPath, { recursive: true, force: true });
  });

  it('reads an empty record list when the cache file is missing', async () => {
    const store = new AntigravityHistoryStore();
    await expect(store.readRecords(vaultPath, CONVERSATION_ID)).resolves.toEqual([]);
  });

  it('writes records atomically without leaving temp files behind', async () => {
    const store = new AntigravityHistoryStore();
    await store.updateRecords(vaultPath, CONVERSATION_ID, existing => [
      ...existing,
      buildAntigravityUserMessageRecord({
        conversationId: CONVERSATION_ID,
        turnIndex: 0,
        text: 'hello',
        timestamp: 1,
      }),
    ]);

    const root = resolveAntigravityCacheRoot(vaultPath)!;
    expect(await fsp.readdir(root)).toEqual([`${CONVERSATION_ID}.jsonl`]);
    const records = await store.readRecords(vaultPath, CONVERSATION_ID);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'user_message', text: 'hello' });
  });

  it('serializes concurrent writers so both updates land intact', async () => {
    const store = new AntigravityHistoryStore();
    await Promise.all([
      store.updateRecords(vaultPath, CONVERSATION_ID, existing => [
        ...existing,
        buildAntigravityUserMessageRecord({
          conversationId: CONVERSATION_ID,
          turnIndex: 0,
          text: 'turn 0',
          timestamp: 1,
        }),
      ]),
      store.updateRecords(vaultPath, CONVERSATION_ID, existing => [
        ...existing,
        buildAntigravityUserMessageRecord({
          conversationId: CONVERSATION_ID,
          turnIndex: 1,
          text: 'turn 1',
          timestamp: 2,
        }),
      ]),
    ]);

    const records = await store.readRecords(vaultPath, CONVERSATION_ID);
    expect(records.map(record => (record.kind === 'user_message' ? record.text : ''))).toEqual([
      'turn 0',
      'turn 1',
    ]);
  });

  it('falls back to a direct write when the platform refuses the atomic replace', async () => {
    renameState.impl = async () => {
      const error = new Error('target locked') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    };

    const store = new AntigravityHistoryStore();
    await store.updateRecords(vaultPath, CONVERSATION_ID, existing => [
      ...existing,
      buildAntigravityUserMessageRecord({
        conversationId: CONVERSATION_ID,
        turnIndex: 0,
        text: 'survives a locked rename',
        timestamp: 1,
      }),
    ]);

    const records = await store.readRecords(vaultPath, CONVERSATION_ID);
    expect(records.map(record => (record.kind === 'user_message' ? record.text : ''))).toEqual([
      'survives a locked rename',
    ]);
    const root = resolveAntigravityCacheRoot(vaultPath)!;
    expect(await fsp.readdir(root)).toEqual([`${CONVERSATION_ID}.jsonl`]);
  });

  it('propagates write failures other than an atomic-replace refusal', async () => {
    renameState.impl = async () => {
      const error = new Error('disk full') as NodeJS.ErrnoException;
      error.code = 'ENOSPC';
      throw error;
    };

    const store = new AntigravityHistoryStore();
    await expect(
      store.updateRecords(vaultPath, CONVERSATION_ID, existing => [
        ...existing,
        buildAntigravityUserMessageRecord({
          conversationId: CONVERSATION_ID,
          turnIndex: 0,
          text: 'never lands',
          timestamp: 1,
        }),
      ]),
    ).rejects.toMatchObject({ code: 'ENOSPC' });

    renameState.impl = actualRename;
    await expect(store.readRecords(vaultPath, CONVERSATION_ID)).resolves.toEqual([]);
  });

  it('refuses to write without a vault path and rejects hostile ids', async () => {
    const store = new AntigravityHistoryStore();
    await expect(
      store.updateRecords(null, CONVERSATION_ID, existing => existing),
    ).rejects.toBeInstanceOf(AntigravityHistoryPathError);
    await expect(
      store.updateRecords(vaultPath, '../escape', existing => existing),
    ).rejects.toBeInstanceOf(AntigravityHistoryPathError);
  });

  it('reports cache presence and deletes the cache file idempotently', async () => {
    const store = new AntigravityHistoryStore();
    expect(await store.cacheFileExists(vaultPath, CONVERSATION_ID)).toBe(false);

    await store.updateRecords(vaultPath, CONVERSATION_ID, existing => [
      ...existing,
      buildAntigravityUserMessageRecord({
        conversationId: CONVERSATION_ID,
        turnIndex: 0,
        text: 'delete me',
        timestamp: 1,
      }),
    ]);
    expect(await store.cacheFileExists(vaultPath, CONVERSATION_ID)).toBe(true);

    await store.deleteRecords(vaultPath, CONVERSATION_ID);
    expect(await store.cacheFileExists(vaultPath, CONVERSATION_ID)).toBe(false);

    await expect(store.deleteRecords(vaultPath, CONVERSATION_ID)).resolves.toBeUndefined();
    await expect(store.deleteRecords(null, CONVERSATION_ID)).resolves.toBeUndefined();
  });

  it('loads a cache file that contains a damaged tail written by a crashed process', async () => {
    const first = buildAntigravityUserMessageRecord({
      conversationId: CONVERSATION_ID,
      turnIndex: 0,
      text: 'kept',
      timestamp: 1,
    });
    const filePath = await writeCacheFileRaw(
      vaultPath,
      CONVERSATION_ID,
      `${JSON.stringify(first)}\n{"v":1,"provider":"antigravity","kind":"tool_us`,
    );

    const store = new AntigravityHistoryStore();
    const records = await store.readRecords(vaultPath, CONVERSATION_ID);
    expect(records).toEqual([first]);
    expect(filePath).toContain('.claudian-plus');
  });
});
