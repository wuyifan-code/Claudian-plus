import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import { isMemoryDuplicate } from './deduplication';
import type { MemoryStore } from './MemoryStore';
import type {
  DurableMindEntry,
  MindScope,
  MindStoreData,
  MindTemporalState,
  StagingMindEntry,
  StagingStoreData,
} from './mind-types';

export const AWARENESS_DIR = '.claudian-plus/awareness';
export const STAGING_HABITS_FILE = `${AWARENESS_DIR}/staging-habits.json`;
export const PROJECT_RULES_FILE = `${AWARENESS_DIR}/project-rules.json`;
export const GLOBAL_PROFILE_FILE = `${AWARENESS_DIR}/global-profile.json`;

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface MindStoreOptions {
  getMemoryStore?: () => MemoryStore | null;
}

export class MindStore {
  private mutationTail: Promise<void> = Promise.resolve();
  private stagingListeners = new Set<(count: number) => void>();
  private getMemoryStore?: () => MemoryStore | null;

  constructor(
    private readonly adapter: VaultFileAdapter,
    options?: MindStoreOptions,
  ) {
    this.getMemoryStore = options?.getMemoryStore;
  }

  setMemoryStoreProvider(provider: () => MemoryStore | null): void {
    this.getMemoryStore = provider;
  }

  onStagingChanged(listener: (count: number) => void): () => void {
    this.stagingListeners.add(listener);
    return () => {
      this.stagingListeners.delete(listener);
    };
  }

  private notifyStagingChanged(count: number): void {
    for (const listener of this.stagingListeners) {
      try {
        listener(count);
      } catch {
        // Safe dispatch
      }
    }
  }

  async getStagingCount(): Promise<number> {
    const data = await this.readStagingData();
    return data.entries.length;
  }

  private async enqueueMutation<T>(op: () => Promise<T>): Promise<T> {
    const next = this.mutationTail.then(op, op);
    this.mutationTail = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  async initialize(): Promise<void> {
    await this.enqueueMutation(async () => {
      await this.adapter.ensureFolder(AWARENESS_DIR);
      if (!(await this.adapter.exists(STAGING_HABITS_FILE))) {
        await this.writeStagingData({ version: 1, entries: [] });
      }
      if (!(await this.adapter.exists(PROJECT_RULES_FILE))) {
        await this.writeDurableData(PROJECT_RULES_FILE, { version: 1, entries: [] });
      }
      if (!(await this.adapter.exists(GLOBAL_PROFILE_FILE))) {
        await this.writeDurableData(GLOBAL_PROFILE_FILE, { version: 1, entries: [] });
      }
    });
  }

  // --- Staging APIs ---

  async listStaging(): Promise<StagingMindEntry[]> {
    const data = await this.readStagingData();
    return data.entries;
  }

  async addStaging(
    input: Omit<StagingMindEntry, 'id' | 'createdAt'>,
  ): Promise<StagingMindEntry | null> {
    return this.enqueueMutation(async () => {
      const data = await this.readStagingData();

      // Check if already in staging
      if (isMemoryDuplicate(input.content, data.entries)) {
        return null;
      }

      // Check if already in durable store
      const durableList = await this.internalListDurable();
      if (isMemoryDuplicate(input.content, durableList)) {
        return null;
      }

      // Check if already in MemoryStore
      const memoryStore = this.getMemoryStore?.();
      if (memoryStore) {
        const memoryEntries = await memoryStore.load();
        if (isMemoryDuplicate(input.content, memoryEntries)) {
          return null;
        }
      }

      const entry: StagingMindEntry = {
        id: generateId('stg'),
        category: input.category,
        scope: input.scope,
        content: input.content.trim(),
        rationale: input.rationale,
        sourceSessionId: input.sourceSessionId,
        createdAt: Date.now(),
        confidence: Math.max(0, Math.min(1, input.confidence ?? 0.8)),
      };

      data.entries.unshift(entry);
      await this.writeStagingData(data);
      return entry;
    });
  }

  async approveStaging(
    id: string,
    overrides?: Partial<Omit<DurableMindEntry, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<DurableMindEntry | null> {
    return this.enqueueMutation(async () => {
      const stagingData = await this.readStagingData();
      const idx = stagingData.entries.findIndex((e) => e.id === id);
      if (idx === -1) {
        return null;
      }

      const [stagingEntry] = stagingData.entries.splice(idx, 1);
      await this.writeStagingData(stagingData);

      const targetScope = overrides?.scope ?? stagingEntry.scope;
      const targetFile = targetScope === 'global' ? GLOBAL_PROFILE_FILE : PROJECT_RULES_FILE;
      const durableData = await this.readDurableData(targetFile);

      const now = Date.now();
      const durableEntry: DurableMindEntry = {
        id: generateId('mind'),
        category: overrides?.category ?? stagingEntry.category,
        scope: targetScope,
        state: overrides?.state ?? 'active',
        content: (overrides?.content ?? stagingEntry.content).trim(),
        confidence: overrides?.confidence ?? stagingEntry.confidence,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        matchPatterns: overrides?.matchPatterns ?? [],
        tags: overrides?.tags ?? [],
        rationale: overrides?.rationale ?? stagingEntry.rationale,
      };

      durableData.entries.unshift(durableEntry);
      await this.writeDurableData(targetFile, durableData);
      return durableEntry;
    });
  }

  async dismissStaging(id: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const data = await this.readStagingData();
      const initialLen = data.entries.length;
      data.entries = data.entries.filter((e) => e.id !== id);
      if (data.entries.length !== initialLen) {
        await this.writeStagingData(data);
        return true;
      }
      return false;
    });
  }

  async approveAllStaging(): Promise<DurableMindEntry[]> {
    return this.enqueueMutation(async () => {
      const stagingData = await this.readStagingData();
      if (stagingData.entries.length === 0) {
        return [];
      }

      const now = Date.now();
      const approved: DurableMindEntry[] = [];
      const projectData = await this.readDurableData(PROJECT_RULES_FILE);
      const globalData = await this.readDurableData(GLOBAL_PROFILE_FILE);

      for (const stg of stagingData.entries) {
        const durable: DurableMindEntry = {
          id: generateId('mind'),
          category: stg.category,
          scope: stg.scope,
          state: 'active',
          content: stg.content.trim(),
          confidence: stg.confidence,
          lastUsedAt: now,
          createdAt: now,
          updatedAt: now,
          matchPatterns: [],
          tags: [],
          rationale: stg.rationale,
        };
        if (stg.scope === 'global') {
          globalData.entries.unshift(durable);
        } else {
          projectData.entries.unshift(durable);
        }
        approved.push(durable);
      }

      await this.writeStagingData({ version: 1, entries: [] });
      await this.writeDurableData(PROJECT_RULES_FILE, projectData);
      await this.writeDurableData(GLOBAL_PROFILE_FILE, globalData);

      return approved;
    });
  }

  async clearStaging(): Promise<void> {
    await this.enqueueMutation(async () => {
      await this.writeStagingData({ version: 1, entries: [] });
    });
  }

  // --- Durable APIs ---

  async listDurable(scope?: MindScope, state?: MindTemporalState): Promise<DurableMindEntry[]> {
    const list = await this.internalListDurable(scope);
    if (!state) return list;
    return list.filter((e) => e.state === state);
  }

  private async internalListDurable(scope?: MindScope): Promise<DurableMindEntry[]> {
    if (scope === 'project') {
      const projectData = await this.readDurableData(PROJECT_RULES_FILE);
      return projectData.entries;
    }
    if (scope === 'global') {
      const globalData = await this.readDurableData(GLOBAL_PROFILE_FILE);
      return globalData.entries;
    }
    const [projectData, globalData] = await Promise.all([
      this.readDurableData(PROJECT_RULES_FILE),
      this.readDurableData(GLOBAL_PROFILE_FILE),
    ]);
    return [...projectData.entries, ...globalData.entries];
  }

  async addDurable(
    input: Omit<DurableMindEntry, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'state'> & {
      state?: MindTemporalState;
    },
  ): Promise<DurableMindEntry | null> {
    return this.enqueueMutation(async () => {
      const targetFile = input.scope === 'global' ? GLOBAL_PROFILE_FILE : PROJECT_RULES_FILE;
      const data = await this.readDurableData(targetFile);

      // Check duplicate against durable entries
      const durableList = await this.internalListDurable();
      if (isMemoryDuplicate(input.content, durableList)) {
        return null;
      }

      // Check duplicate against MemoryStore
      const memoryStore = this.getMemoryStore?.();
      if (memoryStore) {
        const memoryEntries = await memoryStore.load();
        if (isMemoryDuplicate(input.content, memoryEntries)) {
          return null;
        }
      }

      const now = Date.now();
      const entry: DurableMindEntry = {
        id: generateId('mind'),
        category: input.category,
        scope: input.scope,
        state: input.state ?? 'active',
        content: input.content.trim(),
        confidence: Math.max(0, Math.min(1, input.confidence ?? 0.8)),
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        matchPatterns: input.matchPatterns ?? [],
        tags: input.tags ?? [],
        rationale: input.rationale,
      };

      data.entries.unshift(entry);
      await this.writeDurableData(targetFile, data);
      return entry;
    });
  }

  async updateDurable(
    id: string,
    patch: Partial<Omit<DurableMindEntry, 'id' | 'createdAt'>>,
  ): Promise<DurableMindEntry | null> {
    return this.enqueueMutation(async () => {
      const files = [PROJECT_RULES_FILE, GLOBAL_PROFILE_FILE];
      for (const file of files) {
        const data = await this.readDurableData(file);
        const entry = data.entries.find((e) => e.id === id);
        if (entry) {
          if (patch.category !== undefined) entry.category = patch.category;
          if (patch.content !== undefined) entry.content = patch.content.trim();
          if (patch.state !== undefined) entry.state = patch.state;
          if (patch.confidence !== undefined) entry.confidence = patch.confidence;
          if (patch.lastUsedAt !== undefined) entry.lastUsedAt = patch.lastUsedAt;
          if (patch.matchPatterns !== undefined) entry.matchPatterns = patch.matchPatterns;
          if (patch.tags !== undefined) entry.tags = patch.tags;
          if (patch.rationale !== undefined) entry.rationale = patch.rationale;
          entry.updatedAt = Date.now();

          await this.writeDurableData(file, data);
          return entry;
        }
      }
      return null;
    });
  }

  async deleteDurable(id: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      for (const file of [PROJECT_RULES_FILE, GLOBAL_PROFILE_FILE]) {
        const data = await this.readDurableData(file);
        const initLen = data.entries.length;
        data.entries = data.entries.filter((e) => e.id !== id);
        if (data.entries.length !== initLen) {
          await this.writeDurableData(file, data);
          return true;
        }
      }
      return false;
    });
  }

  async recordHit(id: string): Promise<DurableMindEntry | null> {
    return this.enqueueMutation(async () => {
      for (const file of [PROJECT_RULES_FILE, GLOBAL_PROFILE_FILE]) {
        const data = await this.readDurableData(file);
        const entry = data.entries.find((e) => e.id === id);
        if (entry) {
          entry.lastUsedAt = Date.now();
          entry.confidence = Math.min(1.0, entry.confidence + 0.05);
          entry.updatedAt = Date.now();
          await this.writeDurableData(file, data);
          return entry;
        }
      }
      return null;
    });
  }

  async applyDecay(daysThresholdMs: number = 30 * 24 * 60 * 60 * 1000): Promise<DurableMindEntry[]> {
    return this.enqueueMutation(async () => {
      const now = Date.now();
      const decayed: DurableMindEntry[] = [];

      for (const file of [PROJECT_RULES_FILE, GLOBAL_PROFILE_FILE]) {
        const data = await this.readDurableData(file);
        let modified = false;

        for (const entry of data.entries) {
          if (entry.state === 'active' && now - entry.lastUsedAt > daysThresholdMs) {
            entry.state = 'stale';
            entry.confidence = Math.max(0.1, entry.confidence - 0.2);
            entry.updatedAt = now;
            decayed.push(entry);
            modified = true;
          }
        }

        if (modified) {
          await this.writeDurableData(file, data);
        }
      }
      return decayed;
    });
  }

  async forgetRule(keyword: string): Promise<DurableMindEntry | null> {
    return this.enqueueMutation(async () => {
      const normalized = keyword.trim().toLowerCase();
      if (!normalized) return null;

      for (const file of [PROJECT_RULES_FILE, GLOBAL_PROFILE_FILE]) {
        const data = await this.readDurableData(file);
        const idx = data.entries.findIndex((e) => {
          if (e.content.toLowerCase().includes(normalized)) return true;
          if (e.tags?.some((t) => t.toLowerCase().includes(normalized))) return true;
          return false;
        });

        if (idx !== -1) {
          const [removed] = data.entries.splice(idx, 1);
          await this.writeDurableData(file, data);
          return removed;
        }
      }
      return null;
    });
  }

  // --- Internal IO Helpers ---

  private async readStagingData(): Promise<StagingStoreData> {
    try {
      if (await this.adapter.exists(STAGING_HABITS_FILE)) {
        const content = await this.adapter.read(STAGING_HABITS_FILE);
        return JSON.parse(content) as StagingStoreData;
      }
    } catch {
      // Fallback on corrupt json
    }
    return { version: 1, entries: [] };
  }

  private async writeStagingData(data: StagingStoreData): Promise<void> {
    await this.adapter.ensureFolder(AWARENESS_DIR);
    await this.adapter.write(STAGING_HABITS_FILE, JSON.stringify(data, null, 2));
    this.notifyStagingChanged(data.entries.length);
  }

  private async readDurableData(file: string): Promise<MindStoreData> {
    try {
      if (await this.adapter.exists(file)) {
        const content = await this.adapter.read(file);
        return JSON.parse(content) as MindStoreData;
      }
    } catch {
      // Fallback on corrupt json
    }
    return { version: 1, entries: [] };
  }

  private async writeDurableData(file: string, data: MindStoreData): Promise<void> {
    await this.adapter.ensureFolder(AWARENESS_DIR);
    await this.adapter.write(file, JSON.stringify(data, null, 2));
  }
}
