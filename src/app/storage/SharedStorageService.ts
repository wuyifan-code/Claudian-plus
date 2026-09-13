import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';

import { SessionStorage } from '../../core/bootstrap/SessionStorage';
import type { SharedAppStorage } from '../../core/bootstrap/storage';
import { normalizeTabManagerState } from '../../core/bootstrap/tabManagerState';
import { createMemoryCachePolicy } from '../../core/memory/memoryCachePolicy';
import type { AppTabManagerState } from '../../core/providers/types';
import { CachedVaultAdapter } from '../../core/storage/CachedVaultAdapter';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { ClaudianPlusSettingsStorage, type StoredClaudianPlusSettings } from '../settings/ClaudianPlusSettingsStorage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class SharedStorageService implements SharedAppStorage {
  readonly claudianPlusSettings: ClaudianPlusSettingsStorage;
  readonly sessions: SessionStorage;

  private adapter: CachedVaultAdapter;
  private plugin: Plugin;
  private memoryFilePathProvider: () => string | undefined = () => undefined;
  /** Serializes read-modify-write layout saves to prevent stale snapshots winning races. */
  private tabManagerStateWriteTail: Promise<void> = Promise.resolve();

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.adapter = new CachedVaultAdapter(plugin.app, {
      shouldCache: createMemoryCachePolicy({
        getMemoryFilePath: () => this.memoryFilePathProvider(),
      }),
    });
    this.registerContentInvalidation();
    this.claudianPlusSettings = new ClaudianPlusSettingsStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
  }

  /**
   * The memory file path lives in plugin settings, which finish loading after
   * this service is constructed, so the policy resolves it on every lookup.
   */
  setMemoryFilePathProvider(provider: () => string | undefined): void {
    this.memoryFilePathProvider = provider;
  }

  /** Read-through content cache in front of the vault adapter. */
  getContentCache(): CachedVaultAdapter {
    return this.adapter;
  }

  async initialize(): Promise<{ claudianPlus: Record<string, unknown>; hasPersistedSettings: boolean }> {
    const claudianPlus = await this.claudianPlusSettings.load();
    const hasPersistedSettings = await this.claudianPlusSettings.exists();
    return { claudianPlus, hasPersistedSettings };
  }

  async saveClaudianPlusSettings(settings: Record<string, unknown>): Promise<void> {
    await this.claudianPlusSettings.save(settings as StoredClaudianPlusSettings);
  }

  setTabManagerState(state: AppTabManagerState): Promise<void> {
    const write = this.tabManagerStateWriteTail
      .catch(() => undefined)
      .then(async () => {
        try {
          const loaded: unknown = await this.plugin.loadData();
          const data = isRecord(loaded) ? loaded : {};
          data.tabManagerState = state;
          await this.plugin.saveData(data);
        } catch (error) {
          new Notice('Failed to save tab layout');
          throw error;
        }
      });
    this.tabManagerStateWriteTail = write;
    return write;
  }

  async getTabManagerState(): Promise<AppTabManagerState | null> {
    try {
      const data: unknown = await this.plugin.loadData();
      if (!isRecord(data) || !data.tabManagerState) {
        return null;
      }

      return normalizeTabManagerState(data.tabManagerState);
    } catch {
      return null;
    }
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  /**
   * External edits (a user editing `memory.md` in Obsidian) must reach the next
   * turn, so vault events drop the affected cache entries. Writes performed
   * through this service's own adapter are seeded instead of invalidated.
   */
  private registerContentInvalidation(): void {
    const { vault } = this.plugin.app;

    this.plugin.registerEvent(vault.on('modify', file => this.adapter.invalidate(file.path)));
    this.plugin.registerEvent(vault.on('create', file => this.adapter.invalidate(file.path)));
    this.plugin.registerEvent(vault.on('delete', file => this.adapter.invalidateSubtree(file.path)));
    this.plugin.registerEvent(vault.on('rename', (file, oldPath) => {
      this.adapter.invalidateSubtree(oldPath);
      this.adapter.invalidateSubtree(file.path);
    }));
  }
}
