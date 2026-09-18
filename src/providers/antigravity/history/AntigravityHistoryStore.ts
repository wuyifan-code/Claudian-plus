import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { isPathWithinRoot } from '../../../core/storage/pathContainment';

/**
 * Schema version of the provider-owned replay cache. Bump when the record
 * shape changes; loaders skip records carrying a version they do not know
 * instead of failing the whole file.
 */
export const ANTIGRAVITY_HISTORY_SCHEMA_VERSION = 1;

/**
 * Vault-relative root of the provider-owned replay cache. This is a copy of
 * the events the plugin itself received — never a claim of native import, and
 * never a file under the native `~/.gemini/antigravity-cli/` state home.
 */
export const ANTIGRAVITY_HISTORY_CACHE_DIR = '.claudian-plus/providers/antigravity/sessions';

const CACHE_FILE_EXTENSION = '.jsonl';
const PROVIDER_MARKER = 'antigravity';
const MAX_CONVERSATION_ID_LENGTH = 128;
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class AntigravityHistoryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityHistoryPathError';
  }
}

export interface AntigravityHistoryRecordBase {
  v: typeof ANTIGRAVITY_HISTORY_SCHEMA_VERSION;
  provider: typeof PROVIDER_MARKER;
  /** Dedupe key: a record key that already exists in the file is never written again. */
  key: string;
  conversationId: string;
  turnIndex: number;
  timestamp: number;
}

export interface AntigravityUserMessageRecord extends AntigravityHistoryRecordBase {
  kind: 'user_message';
  text: string;
}

export interface AntigravityAssistantTextRecord extends AntigravityHistoryRecordBase {
  kind: 'assistant_text';
  text: string;
}

export interface AntigravityToolUseRecord extends AntigravityHistoryRecordBase {
  kind: 'tool_use';
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface AntigravityToolResultRecord extends AntigravityHistoryRecordBase {
  kind: 'tool_result';
  toolId: string;
  content: string;
  isError: boolean;
  toolUseResult?: Record<string, unknown>;
}

export type AntigravityHistoryRecord =
  | AntigravityUserMessageRecord
  | AntigravityAssistantTextRecord
  | AntigravityToolUseRecord
  | AntigravityToolResultRecord;

export type AntigravityHistoryTurnUpdate = (
  existing: AntigravityHistoryRecord[],
) => AntigravityHistoryRecord[] | null;

export function buildAntigravityUserRecordKey(conversationId: string, turnIndex: number): string {
  return `agy:${conversationId}:turn${turnIndex}:user`;
}

export function buildAntigravityAssistantRecordKey(
  conversationId: string,
  turnIndex: number,
  ordinal: number,
): string {
  return `agy:${conversationId}:turn${turnIndex}:text:${ordinal}`;
}

export function buildAntigravityToolUseRecordKey(toolId: string): string {
  return `${toolId}:use`;
}

export function buildAntigravityToolResultRecordKey(toolId: string): string {
  return `${toolId}:result`;
}

export function buildAntigravityUserMessageRecord(fields: {
  conversationId: string;
  turnIndex: number;
  text: string;
  timestamp: number;
}): AntigravityUserMessageRecord {
  return {
    v: ANTIGRAVITY_HISTORY_SCHEMA_VERSION,
    provider: PROVIDER_MARKER,
    kind: 'user_message',
    key: buildAntigravityUserRecordKey(fields.conversationId, fields.turnIndex),
    conversationId: fields.conversationId,
    turnIndex: fields.turnIndex,
    timestamp: fields.timestamp,
    text: fields.text,
  };
}

export function buildAntigravityAssistantTextRecord(fields: {
  conversationId: string;
  turnIndex: number;
  ordinal: number;
  text: string;
  timestamp: number;
}): AntigravityAssistantTextRecord {
  return {
    v: ANTIGRAVITY_HISTORY_SCHEMA_VERSION,
    provider: PROVIDER_MARKER,
    kind: 'assistant_text',
    key: buildAntigravityAssistantRecordKey(fields.conversationId, fields.turnIndex, fields.ordinal),
    conversationId: fields.conversationId,
    turnIndex: fields.turnIndex,
    timestamp: fields.timestamp,
    text: fields.text,
  };
}

export function buildAntigravityToolUseRecord(fields: {
  conversationId: string;
  turnIndex: number;
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
  timestamp: number;
}): AntigravityToolUseRecord {
  return {
    v: ANTIGRAVITY_HISTORY_SCHEMA_VERSION,
    provider: PROVIDER_MARKER,
    kind: 'tool_use',
    key: buildAntigravityToolUseRecordKey(fields.toolId),
    conversationId: fields.conversationId,
    turnIndex: fields.turnIndex,
    timestamp: fields.timestamp,
    toolId: fields.toolId,
    toolName: fields.toolName,
    input: fields.input,
  };
}

export function buildAntigravityToolResultRecord(fields: {
  conversationId: string;
  turnIndex: number;
  toolId: string;
  content: string;
  isError: boolean;
  toolUseResult?: Record<string, unknown>;
  timestamp: number;
}): AntigravityToolResultRecord {
  return {
    v: ANTIGRAVITY_HISTORY_SCHEMA_VERSION,
    provider: PROVIDER_MARKER,
    kind: 'tool_result',
    key: buildAntigravityToolResultRecordKey(fields.toolId),
    conversationId: fields.conversationId,
    turnIndex: fields.turnIndex,
    timestamp: fields.timestamp,
    toolId: fields.toolId,
    content: fields.content,
    isError: fields.isError,
    ...(fields.toolUseResult ? { toolUseResult: fields.toolUseResult } : {}),
  };
}

/** Resolves the vault-relative cache root; null when no vault is available. */
export function resolveAntigravityCacheRoot(vaultPath: string | null): string | null {
  const trimmed = vaultPath?.trim();
  if (!trimmed) {
    return null;
  }
  if (!path.isAbsolute(trimmed)) {
    throw new AntigravityHistoryPathError(
      'Antigravity history cache requires an absolute vault path.',
    );
  }
  return path.join(trimmed, ...ANTIGRAVITY_HISTORY_CACHE_DIR.split('/'));
}

/**
 * Validates a conversation id as a single cache file name component. The ids
 * come from `agy` stream events (UUIDs), but the cache must reject anything
 * that could traverse out of the sessions root.
 */
export function buildAntigravityCacheFileName(conversationId: string): string {
  const trimmed = typeof conversationId === 'string' ? conversationId.trim() : '';
  if (
    !trimmed
    || trimmed.length > MAX_CONVERSATION_ID_LENGTH
    || !CONVERSATION_ID_PATTERN.test(trimmed)
    || trimmed.includes('..')
  ) {
    throw new AntigravityHistoryPathError(
      `Antigravity history cache rejected an unsafe conversation id: ${JSON.stringify(
        typeof conversationId === 'string' ? conversationId.slice(0, 64) : String(conversationId),
      )}`,
    );
  }
  return `${trimmed}${CACHE_FILE_EXTENSION}`;
}

/**
 * Resolves the cache file for a conversation inside the configured root.
 * Returns null only when no vault path exists; throws AntigravityHistoryPathError
 * for hostile ids or paths that escape the root.
 */
export function resolveAntigravityCacheFile(
  vaultPath: string | null,
  conversationId: string,
): string | null {
  const root = resolveAntigravityCacheRoot(vaultPath);
  if (!root) {
    return null;
  }
  const resolved = path.join(root, buildAntigravityCacheFileName(conversationId));
  if (!isPathWithinRoot(resolved, root)) {
    throw new AntigravityHistoryPathError(
      'Antigravity history cache path escaped the configured sessions root.',
    );
  }
  return resolved;
}

/**
 * Parses cached NDJSON content. Recovery rule: any line that fails to parse or
 * fails the schema check is dropped individually — in particular a half-written
 * trailing line from a crashed write only drops itself, never the rest of the
 * file. Records from a foreign provider, future schema versions, and duplicate
 * keys (first occurrence wins) are skipped the same way.
 */
export function parseAntigravityHistoryContent(content: string): AntigravityHistoryRecord[] {
  const records: AntigravityHistoryRecord[] = [];
  const seenKeys = new Set<string>();
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const record = parseAntigravityHistoryRecord(line);
    if (!record || seenKeys.has(record.key)) {
      continue;
    }
    seenKeys.add(record.key);
    records.push(record);
  }
  return records;
}

function parseAntigravityHistoryRecord(line: string): AntigravityHistoryRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) {
    return null;
  }
  if (parsed.v !== ANTIGRAVITY_HISTORY_SCHEMA_VERSION || parsed.provider !== PROVIDER_MARKER) {
    return null;
  }

  const base = readRecordBase(parsed);
  if (!base) {
    return null;
  }

  switch (parsed.kind) {
    case 'user_message':
      return typeof parsed.text === 'string'
        ? { ...base, kind: 'user_message', text: parsed.text }
        : null;
    case 'assistant_text':
      return typeof parsed.text === 'string'
        ? { ...base, kind: 'assistant_text', text: parsed.text }
        : null;
    case 'tool_use':
      return typeof parsed.toolId === 'string'
        && typeof parsed.toolName === 'string'
        && isPlainObject(parsed.input)
        ? {
            ...base,
            kind: 'tool_use',
            toolId: parsed.toolId,
            toolName: parsed.toolName,
            input: parsed.input,
          }
        : null;
    case 'tool_result':
      return typeof parsed.toolId === 'string'
        && typeof parsed.content === 'string'
        && typeof parsed.isError === 'boolean'
        ? {
            ...base,
            kind: 'tool_result',
            toolId: parsed.toolId,
            content: parsed.content,
            isError: parsed.isError,
            ...(isPlainObject(parsed.toolUseResult) ? { toolUseResult: parsed.toolUseResult } : {}),
          }
        : null;
    default:
      return null;
  }
}

function readRecordBase(
  parsed: Record<string, unknown>,
): Pick<AntigravityHistoryRecordBase, 'v' | 'provider' | 'key' | 'conversationId' | 'turnIndex' | 'timestamp'> | null {
  if (
    typeof parsed.key !== 'string'
    || parsed.key.length === 0
    || typeof parsed.conversationId !== 'string'
    || parsed.conversationId.length === 0
    || typeof parsed.turnIndex !== 'number'
    || !Number.isInteger(parsed.turnIndex)
    || parsed.turnIndex < 0
    || typeof parsed.timestamp !== 'number'
    || !Number.isFinite(parsed.timestamp)
  ) {
    return null;
  }
  return {
    v: ANTIGRAVITY_HISTORY_SCHEMA_VERSION,
    provider: PROVIDER_MARKER,
    key: parsed.key,
    conversationId: parsed.conversationId,
    turnIndex: parsed.turnIndex,
    timestamp: parsed.timestamp,
  };
}

/**
 * Reads the cache file. A missing or unreadable file yields an empty list —
 * a lost transcript is never a hard failure and never a reason to treat the
 * conversation as deleted.
 */
export async function readAntigravityHistoryRecords(
  filePath: string,
): Promise<AntigravityHistoryRecord[]> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return [];
  }
  return parseAntigravityHistoryContent(content);
}

function serializeAntigravityHistoryRecords(records: AntigravityHistoryRecord[]): string {
  if (records.length === 0) {
    return '';
  }
  return `${records.map(record => JSON.stringify(record)).join('\n')}\n`;
}

function recordsAreEqual(
  left: AntigravityHistoryRecord[],
  right: AntigravityHistoryRecord[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) {
      return false;
    }
  }
  return true;
}

function isAtomicReplaceRefusal(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

async function removeFileQuietly(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // The temp file is best-effort cleanup; never mask the original error.
  }
}

/**
 * Replaces the cache file through a temp-then-rename write. The handle is
 * always released, the temp file is always cleaned up, and when the platform
 * refuses the atomic replace (Windows target locks surface as EPERM/EACCES/
 * EBUSY) the write falls back to a direct write so one locked rename cannot
 * lose the turn.
 */
export async function writeAntigravityHistoryRecords(
  filePath: string,
  records: AntigravityHistoryRecord[],
): Promise<void> {
  const payload = serializeAntigravityHistoryRecords(records);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let handle: fs.FileHandle | null = null;
  let tempWritten = false;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    handle = await fs.open(tempPath, 'w');
    await handle.writeFile(payload, 'utf-8');
    await handle.sync();
    tempWritten = true;
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    if (!tempWritten) {
      await removeFileQuietly(tempPath);
    }
  }

  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    if (!isAtomicReplaceRefusal(error)) {
      await removeFileQuietly(tempPath);
      throw error;
    }
    try {
      await fs.writeFile(filePath, payload, 'utf-8');
    } finally {
      await removeFileQuietly(tempPath);
    }
  }
}

/**
 * File-mechanics layer for the provider-owned replay cache. All writes for one
 * cache file run through a per-path promise chain, so two turns can never
 * interleave their read-modify-write cycles even when callers race.
 */
export class AntigravityHistoryStore {
  private writeQueues = new Map<string, Promise<unknown>>();

  async readRecords(vaultPath: string | null, conversationId: string): Promise<AntigravityHistoryRecord[]> {
    const filePath = resolveAntigravityCacheFile(vaultPath, conversationId);
    if (!filePath) {
      return [];
    }
    return this.enqueue(filePath, () => readAntigravityHistoryRecords(filePath));
  }

  /**
   * Read-modify-write of one cache file. The updater returns the full next
   * record list, or null when nothing changed. No write happens for a no-op.
   */
  async updateRecords(
    vaultPath: string | null,
    conversationId: string,
    update: AntigravityHistoryTurnUpdate,
  ): Promise<void> {
    const filePath = resolveAntigravityCacheFile(vaultPath, conversationId);
    if (!filePath) {
      throw new AntigravityHistoryPathError(
        'Antigravity history cache writes require a vault path.',
      );
    }
    await this.enqueue(filePath, async () => {
      const existing = await readAntigravityHistoryRecords(filePath);
      const next = update(existing);
      if (!next || recordsAreEqual(existing, next)) {
        return;
      }
      await writeAntigravityHistoryRecords(filePath, next);
    });
  }

  async cacheFileExists(vaultPath: string | null, conversationId: string): Promise<boolean> {
    const filePath = resolveAntigravityCacheFile(vaultPath, conversationId);
    if (!filePath) {
      return false;
    }
    try {
      return (await fs.stat(filePath)).isFile();
    } catch {
      return false;
    }
  }

  /** Removes the cache file. A missing file is a no-op, never an error. */
  async deleteRecords(vaultPath: string | null, conversationId: string): Promise<void> {
    const filePath = resolveAntigravityCacheFile(vaultPath, conversationId);
    if (!filePath) {
      return;
    }
    await this.enqueue(filePath, async () => {
      await fs.rm(filePath, { force: true });
    });
  }

  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const tail = this.writeQueues.get(key);
    const queued = (tail ?? Promise.resolve()).then(operation, operation);
    const nextTail = queued.catch(() => undefined);
    this.writeQueues.set(key, nextTail);
    void nextTail.finally(() => {
      if (this.writeQueues.get(key) === nextTail) {
        this.writeQueues.delete(key);
      }
    }).catch(() => undefined);
    return queued;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
