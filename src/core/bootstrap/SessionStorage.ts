import { mapWithConcurrency } from '../../utils/concurrency';
import { getConversationSearchText } from '../../utils/context';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type SessionMetadataListOptions,
  type SessionMetadataScanResult,
} from '../providers/types';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type {
  Conversation,
  ConversationMeta,
  SessionMetadata,
  UsageInfo,
} from '../types';
import {
  LEGACY_CLAUDIAN_SESSIONS_PATH,
  LEGACY_SESSION_PATHS,
  LEGACY_SESSIONS_PATH,
  SESSIONS_PATH,
} from './StoragePaths';

export {
  LEGACY_CLAUDIAN_SESSIONS_PATH,
  LEGACY_SESSION_PATHS,
  LEGACY_SESSIONS_PATH,
  SESSIONS_PATH,
};

const SAFE_METADATA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SESSION_METADATA_READ_CONCURRENCY = 8;
const SESSION_METADATA_PUBLISH_BATCH_SIZE = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isUsageInfo(value: unknown): value is UsageInfo {
  if (!isRecord(value)
    || !isFiniteNumber(value.inputTokens)
    || !isFiniteNumber(value.contextWindow)
    || !isFiniteNumber(value.contextTokens)
    || !isFiniteNumber(value.percentage)) {
    return false;
  }

  return (value.model === undefined || typeof value.model === 'string')
    && (value.cacheCreationInputTokens === undefined || isFiniteNumber(value.cacheCreationInputTokens))
    && (value.cacheReadInputTokens === undefined || isFiniteNumber(value.cacheReadInputTokens))
    && (value.contextWindowIsAuthoritative === undefined
      || typeof value.contextWindowIsAuthoritative === 'boolean');
}

/**
 * Metadata files are user-writable JSON. Keep malformed values out of the
 * history bootstrap path so a single damaged file cannot produce an invalid
 * conversation shell or break sidebar rendering.
 */
function parseSessionMetadata(value: unknown, expectedId: string): SessionMetadata | null {
  if (!isRecord(value)
    || value.id !== expectedId
    || !isValidSessionMetadataId(expectedId)
    || typeof value.title !== 'string'
    || !isFiniteNumber(value.createdAt)
    || !isFiniteNumber(value.updatedAt)) {
    return null;
  }

  const metadata: SessionMetadata = {
    id: expectedId,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  if (typeof value.providerId === 'string' && value.providerId.length > 0) {
    metadata.providerId = value.providerId;
  }
  if (typeof value.searchText === 'string' && value.searchText.length > 0) {
    metadata.searchText = value.searchText.slice(0, 12_000);
  }
  if (value.titleGenerationStatus === 'pending'
    || value.titleGenerationStatus === 'success'
    || value.titleGenerationStatus === 'failed') {
    metadata.titleGenerationStatus = value.titleGenerationStatus;
  }
  if (isFiniteNumber(value.lastResponseAt)) metadata.lastResponseAt = value.lastResponseAt;
  if (typeof value.sessionId === 'string' || value.sessionId === null) {
    metadata.sessionId = value.sessionId;
  }
  if (typeof value.selectedModel === 'string') metadata.selectedModel = value.selectedModel;
  if (isRecord(value.providerState)) metadata.providerState = value.providerState;
  if (typeof value.currentNote === 'string') metadata.currentNote = value.currentNote;
  if (isStringArray(value.externalContextPaths)) {
    metadata.externalContextPaths = value.externalContextPaths;
  }
  if (isStringArray(value.enabledMcpServers)) metadata.enabledMcpServers = value.enabledMcpServers;
  if (isUsageInfo(value.usage)) metadata.usage = value.usage;
  if (typeof value.resumeAtMessageId === 'string') {
    metadata.resumeAtMessageId = value.resumeAtMessageId;
  }

  return metadata;
}

export function isValidSessionMetadataId(id: string): boolean {
  return SAFE_METADATA_ID_PATTERN.test(id)
    && id !== '.'
    && id !== '..'
    && !/%(?:2f|5c)/i.test(id);
}

function assertValidSessionMetadataId(id: string): void {
  if (!isValidSessionMetadataId(id)) {
    throw new Error(`Invalid session metadata id: ${JSON.stringify(id)}`);
  }
}

export class SessionStorage {
  constructor(private adapter: VaultFileAdapter) {}

  getMetadataPath(id: string): string {
    assertValidSessionMetadataId(id);
    return `${SESSIONS_PATH}/${id}.meta.json`;
  }

  getLegacyMetadataPath(id: string): string {
    assertValidSessionMetadataId(id);
    return `${LEGACY_SESSIONS_PATH}/${id}.meta.json`;
  }

  getLegacyClaudianMetadataPath(id: string): string {
    assertValidSessionMetadataId(id);
    return `${LEGACY_CLAUDIAN_SESSIONS_PATH}/${id}.meta.json`;
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    const filePath = this.getMetadataPath(metadata.id);
    const content = JSON.stringify(metadata, null, 2);
    await this.adapter.write(filePath, content);
    await this.deleteLegacyMetadataIfPresent(metadata.id);
  }

  async loadMetadata(id: string): Promise<SessionMetadata | null> {
    if (!isValidSessionMetadataId(id)) {
      return null;
    }
    let filePath: string | null;
    let metadata: SessionMetadata;
    try {
      filePath = await this.getLoadPath(id);
      if (!filePath) {
        return null;
      }

      const content = await this.adapter.read(filePath);
      const parsed = parseSessionMetadata(JSON.parse(content), id);
      if (!parsed) {
        return null;
      }
      metadata = parsed;
    } catch {
      return null;
    }

    if (filePath !== this.getMetadataPath(id)) {
      try {
        await this.saveMetadata(metadata);
      } catch {
        // Migration is best-effort; keep valid legacy metadata visible.
      }
    }

    return metadata;
  }

  async deleteMetadata(id: string): Promise<void> {
    await this.adapter.delete(this.getMetadataPath(id));
    await this.deleteLegacyMetadataIfPresent(id);
  }

  async listMetadata(options: SessionMetadataListOptions = {}): Promise<SessionMetadata[]> {
    return (await this.scanMetadata(options)).metadata;
  }

  async scanMetadata(
    options: SessionMetadataListOptions = {},
  ): Promise<SessionMetadataScanResult> {
    const fileListing = await this.listUniqueMetadataFiles();
    let complete = fileListing.complete;
    let invalidMetadataCount = 0;
    const pendingBatch: SessionMetadata[] = [];
    const batchSize = Math.max(1, options.batchSize ?? SESSION_METADATA_PUBLISH_BATCH_SIZE);
    const publish = (metadata: SessionMetadata): void => {
      if (!options.onBatch) return;
      pendingBatch.push(metadata);
      if (pendingBatch.length >= batchSize) {
        options.onBatch(pendingBatch.splice(0, pendingBatch.length));
      }
    };
    const metas = await mapWithConcurrency(fileListing.files, async (filePath) => {
      const fileId = this.getMetadataIdFromPath(filePath);
      if (!fileId || !isValidSessionMetadataId(fileId)) {
        return null;
      }
      let content: string;
      try {
        content = await this.adapter.read(filePath);
      } catch {
        complete = false;
        // A later scan may recover a transient I/O failure.
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        invalidMetadataCount += 1;
        return null;
      }
      const raw = parseSessionMetadata(parsed, fileId);
      if (!raw) {
        invalidMetadataCount += 1;
        return null;
      }

      if (LEGACY_SESSION_PATHS.some(path => filePath.startsWith(`${path}/`))) {
        try {
          await this.saveMetadata(raw);
        } catch {
          // Migration is best-effort; keep valid legacy metadata visible.
        }
      }
      publish(raw);
      return raw;
    }, SESSION_METADATA_READ_CONCURRENCY);

    if (pendingBatch.length > 0) {
      options.onBatch?.(pendingBatch.splice(0, pendingBatch.length));
    }

    return {
      metadata: metas.filter((meta): meta is SessionMetadata => meta !== null),
      complete,
      invalidMetadataCount,
    };
  }

  async listAllConversations(): Promise<ConversationMeta[]> {
    const nativeMetas = await this.listMetadata();

    const metas: ConversationMeta[] = nativeMetas.map((meta) => ({
      id: meta.id,
      providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
      title: meta.title,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastResponseAt: meta.lastResponseAt,
      messageCount: 0,
      preview: 'SDK session',
      titleGenerationStatus: meta.titleGenerationStatus,
      ...(meta.searchText ? { searchText: meta.searchText } : {}),
    }));

    return metas.sort((a, b) =>
      (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt)
    );
  }

  toSessionMetadata(conversation: Conversation): SessionMetadata {
    const historyService = ProviderRegistry.getConversationHistoryService(conversation.providerId);
    const providerState = historyService.buildPersistedProviderState
      ? historyService.buildPersistedProviderState(conversation)
      : conversation.providerState;

    const searchText = getConversationSearchText(conversation);
    return {
      id: conversation.id,
      providerId: conversation.providerId,
      title: conversation.title,
      ...(searchText ? { searchText } : {}),
      titleGenerationStatus: conversation.titleGenerationStatus,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      sessionId: conversation.sessionId,
      selectedModel: conversation.selectedModel,
      providerState: providerState && Object.keys(providerState).length > 0 ? providerState : undefined,
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      usage: conversation.usage,
      resumeAtMessageId: conversation.resumeAtMessageId,
    };
  }

  private async getLoadPath(id: string): Promise<string | null> {
    const filePath = this.getMetadataPath(id);
    if (await this.adapter.exists(filePath)) {
      return filePath;
    }

    for (const legacyPath of LEGACY_SESSION_PATHS) {
      const legacyFilePath = `${legacyPath}/${id}.meta.json`;
      if (await this.adapter.exists(legacyFilePath)) {
        return legacyFilePath;
      }
    }

    return null;
  }

  private async deleteLegacyMetadataIfPresent(id: string): Promise<void> {
    for (const legacyPath of LEGACY_SESSION_PATHS) {
      const legacyFilePath = `${legacyPath}/${id}.meta.json`;
      if (await this.adapter.exists(legacyFilePath)) {
        await this.adapter.delete(legacyFilePath);
      }
    }
  }

  private async listUniqueMetadataFiles(): Promise<{ files: string[]; complete: boolean }> {
    const preferredFiles = await this.listMetadataFiles(SESSIONS_PATH);
    const legacyListings = await Promise.all(
      LEGACY_SESSION_PATHS.map(path => this.listMetadataFiles(path)),
    );
    const filesByName = new Map<string, string>();

    for (const filePath of preferredFiles.files) {
      filesByName.set(this.getFileName(filePath), filePath);
    }

    for (const listing of legacyListings) {
      for (const filePath of listing.files) {
        const fileName = this.getFileName(filePath);
        if (!filesByName.has(fileName)) {
          filesByName.set(fileName, filePath);
        }
      }
    }

    return {
      files: Array.from(filesByName.values()),
      complete: preferredFiles.complete && legacyListings.every(listing => listing.complete),
    };
  }

  private async listMetadataFiles(
    folderPath: string,
  ): Promise<{ files: string[]; complete: boolean }> {
    try {
      const files = await this.adapter.listFiles(folderPath);
      return {
        files: files.filter((filePath) => filePath.endsWith('.meta.json')),
        complete: true,
      };
    } catch {
      return { files: [], complete: false };
    }
  }

  private getFileName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1] ?? filePath;
  }

  private getMetadataIdFromPath(filePath: string): string | null {
    const fileName = this.getFileName(filePath);
    const suffix = '.meta.json';
    return fileName.endsWith(suffix)
      ? fileName.slice(0, -suffix.length)
      : null;
  }
}
