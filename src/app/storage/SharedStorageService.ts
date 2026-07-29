import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';

import { SessionStorage } from '../../core/bootstrap/SessionStorage';
import type { SharedAppStorage } from '../../core/bootstrap/storage';
import { normalizeTabManagerState } from '../../core/bootstrap/tabManagerState';
import type { AppTabManagerState } from '../../core/providers/types';
import { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { ClaudianPlusSettingsStorage, type StoredClaudianPlusSettings } from '../settings/ClaudianPlusSettingsStorage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class SharedStorageService implements SharedAppStorage {
  readonly claudianPlusSettings: ClaudianPlusSettingsStorage;
  readonly sessions: SessionStorage;

  private adapter: VaultFileAdapter;
  private plugin: Plugin;
  /** Serializes read-modify-write layout saves to prevent stale snapshots winning races. */
  private tabManagerStateWriteTail: Promise<void> = Promise.resolve();

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.adapter = new VaultFileAdapter(plugin.app);
    this.claudianPlusSettings = new ClaudianPlusSettingsStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
  }

  async initialize(): Promise<{ claudianPlus: Record<string, unknown> }> {
    const claudianPlus = await this.claudianPlusSettings.load();
    return { claudianPlus };
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
}
