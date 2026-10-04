import type { IMemoryStorageAdapter } from './storage/MemoryStorageAdapter';
import type {
  CheckpointsState,
  CurrentPointer,
  DreamJob,
  DreamJobStatus,
  DreamProposal,
  EpisodeRecord,
  ForgetEntry,
  MemoryFeedbackRecord,
  MemoryKind,
  MemoryRecord,
  MemoryScope,
  MemoryStatus,
} from './types';

export interface MemoryRepositoryOptions {
  storage: IMemoryStorageAdapter;
  vaultId: string;
  baseDir?: string;
}

export type CommitExplicitAction = 'remember' | 'correct' | 'forget';

export interface CommitExplicitParams {
  action: CommitExplicitAction;
  kind?: MemoryKind;
  claimKey?: string;
  content?: string;
  scope: MemoryScope;
  targetId?: string;
  reason?: string;
  conditions?: string[];
  outcome?: 'succeeded' | 'failed' | 'unknown';
}

export interface ForgetCommitResult {
  suppressedCount: number;
  entry: ForgetEntry;
}

export interface CommitDreamParams {
  jobId: string;
  proposals: DreamProposal[];
  adjudicatedEvents: {
    fromEventId?: string;
    toEventId?: string;
    eventCount: number;
  };
  expectedGenRevision: string;
}

export interface DreamCommitResult {
  appliedCount: number;
  rejectedCount: number;
  newGenRevision: string;
}

export class MemoryRepository {
  private readonly storage: IMemoryStorageAdapter;
  private readonly vaultId: string;
  private readonly baseDir: string;

  private currentGen: string = 'gen_000001';
  private cachedRecords: MemoryRecord[] = [];
  private cachedJobs: DreamJob[] = [];
  private cachedCheckpoints: CheckpointsState = {
    adjudicatedEventCount: 0,
    version: 1,
  };
  private cachedForgetLedger: ForgetEntry[] = [];
  private initialized = false;

  constructor(options: MemoryRepositoryOptions) {
    this.storage = options.storage;
    this.vaultId = options.vaultId;
    this.baseDir = options.baseDir ?? `vaults/${this.vaultId}`;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.storage.mkdir(this.baseDir);
    await this.storage.mkdir(`${this.baseDir}/episodes`);
    await this.storage.mkdir(`${this.baseDir}/forget-ledger`);
    await this.storage.mkdir(`${this.baseDir}/feedback`);
    await this.storage.mkdir(`${this.baseDir}/generations`);

    // Load forget ledger first
    await this.loadForgetLedger();

    const currentPath = `${this.baseDir}/CURRENT`;
    if (await this.storage.exists(currentPath)) {
      try {
        const raw = await this.storage.readFile(currentPath);
        const pointer = JSON.parse(raw) as CurrentPointer;
        this.currentGen = pointer.currentRevision;
        await this.loadGeneration(this.currentGen);
        this.initialized = true;
        return;
      } catch {
        // Fallback to initial generation creation if CURRENT is corrupted
      }
    }

    // Bootstrap initial generation gen_000001
    this.currentGen = 'gen_000001';
    this.cachedRecords = [];
    this.cachedJobs = [];
    this.cachedCheckpoints = {
      adjudicatedEventCount: 0,
      version: 1,
    };
    await this.persistGeneration(this.currentGen);
    this.initialized = true;
  }

  async getCurrentGeneration(): Promise<string> {
    this.assertInitialized();
    return this.currentGen;
  }

  async listRecords(filter?: { status?: MemoryStatus; kind?: MemoryKind }): Promise<MemoryRecord[]> {
    this.assertInitialized();
    return this.cachedRecords.filter((rec) => {
      if (filter?.status && rec.status !== filter.status) return false;
      if (filter?.kind && rec.kind !== filter.kind) return false;
      return true;
    });
  }

  async listJobs(filter?: { status?: DreamJobStatus }): Promise<DreamJob[]> {
    this.assertInitialized();
    return this.cachedJobs.filter((job) => {
      if (filter?.status && job.status !== filter.status) return false;
      return true;
    });
  }

  async enqueueJob(job: DreamJob): Promise<void> {
    this.assertInitialized();
    const token = await this.acquireWriterLock();
    try {
      this.cachedJobs.push(job);
      const nextGen = this.nextGenerationName(this.currentGen);
      await this.persistGeneration(nextGen);
      this.currentGen = nextGen;
    } finally {
      if (token) {
        await this.releaseWriterLock(token);
      }
    }
  }

  async updateJob(job: DreamJob): Promise<void> {
    this.assertInitialized();
    const token = await this.acquireWriterLock();
    try {
      const idx = this.cachedJobs.findIndex((j) => j.id === job.id);
      if (idx >= 0) {
        this.cachedJobs[idx] = { ...job, updatedAt: Date.now() };
      } else {
        this.cachedJobs.push(job);
      }
      const nextGen = this.nextGenerationName(this.currentGen);
      await this.persistGeneration(nextGen);
      this.currentGen = nextGen;
    } finally {
      if (token) {
        await this.releaseWriterLock(token);
      }
    }
  }

  async hasMigrationRun(name: string): Promise<boolean> {
    this.assertInitialized();
    const migrationPath = `${this.baseDir}/migrations/${name}.json`;
    return await this.storage.exists(migrationPath);
  }

  async recordMigration(name: string, metadata?: Record<string, unknown>): Promise<void> {
    this.assertInitialized();
    const migrationDir = `${this.baseDir}/migrations`;
    await this.storage.mkdir(migrationDir);
    const migrationPath = `${migrationDir}/${name}.json`;
    await this.storage.writeFileAtomic(
      migrationPath,
      JSON.stringify({ name, completedAt: Date.now(), ...(metadata ?? {}) }, null, 2),
    );
  }

  async getCheckpoints(): Promise<CheckpointsState> {
    this.assertInitialized();
    return { ...this.cachedCheckpoints };
  }

  async getForgetLedger(): Promise<ForgetEntry[]> {
    this.assertInitialized();
    return [...this.cachedForgetLedger];
  }

  isSuppressed(item: { claimKey?: string; content?: string; rootEventId?: string }): boolean {
    for (const entry of this.cachedForgetLedger) {
      if (entry.claimKey && item.claimKey && entry.claimKey === item.claimKey) {
        return true;
      }
      if (entry.rootEventId && item.rootEventId && entry.rootEventId === item.rootEventId) {
        return true;
      }
      if (entry.contentHash && item.content) {
        const hash = this.simpleHash(item.content);
        if (entry.contentHash === hash) {
          return true;
        }
      }
    }
    return false;
  }

  async commitExplicit(params: CommitExplicitParams): Promise<MemoryRecord & ForgetCommitResult> {
    this.assertInitialized();
    const token = await this.acquireWriterLock();
    try {
      if (params.action === 'forget') {
        const claimKey = params.claimKey;
        const reason = params.reason ?? 'User explicitly forgot';
        const contentHash = params.content ? this.simpleHash(params.content) : undefined;
        const forgetEntry: ForgetEntry = {
          id: `forget_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          claimKey,
          contentHash,
          reason,
          createdAt: Date.now(),
        };

        // Persist forget entry file
        await this.storage.writeFileAtomic(
          `${this.baseDir}/forget-ledger/${forgetEntry.id}.json`,
          JSON.stringify(forgetEntry, null, 2),
        );
        this.cachedForgetLedger.push(forgetEntry);

        // Update affected memory records to superseded / archived
        let suppressedCount = 0;
        for (const rec of this.cachedRecords) {
          if (
            (claimKey && rec.claimKey === claimKey) ||
            (contentHash && this.simpleHash(rec.content) === contentHash)
          ) {
            rec.status = 'archived';
            rec.revision += 1;
            suppressedCount++;
          }
        }

        const nextGen = this.nextGenerationName(this.currentGen);
        await this.persistGeneration(nextGen);
        this.currentGen = nextGen;

        return {
          suppressedCount,
          entry: forgetEntry,
        } as unknown as MemoryRecord & ForgetCommitResult;
      }

      if (params.action === 'correct') {
        const now = Date.now();
        const newId = `mem_${now}_${Math.random().toString(36).slice(2, 7)}`;
        let supersededId = params.targetId;

        // If no explicit targetId given, find existing active record by claimKey in the same scope
        if (!supersededId && params.claimKey) {
          const match = this.cachedRecords.find(
            (r) =>
              r.status === 'active' &&
              r.claimKey === params.claimKey &&
              r.scope.vaultId === params.scope.vaultId &&
              r.scope.projectId === params.scope.projectId,
          );
          if (match) supersededId = match.id;
        }

        let oldRevision = 1;
        if (supersededId) {
          const oldRec = this.cachedRecords.find((r) => r.id === supersededId);
          if (oldRec) {
            oldRec.status = 'superseded';
            oldRec.revision += 1;
            oldRevision = oldRec.revision;
          }
        }

        const newRecord: MemoryRecord = {
          id: newId,
          revision: oldRevision,
          kind: params.kind ?? 'project_state',
          scope: params.scope,
          claimKey: params.claimKey ?? `claim_${now}`,
          content: params.content ?? '',
          status: 'active',
          basis: 'explicit',
          evidence: [],
          observedAt: now,
          supersedes: supersededId ? [supersededId] : [],
          conditions: params.conditions,
          outcome: params.outcome,
        };

        this.cachedRecords.push(newRecord);
        const nextGen = this.nextGenerationName(this.currentGen);
        await this.persistGeneration(nextGen);
        this.currentGen = nextGen;

        return newRecord as MemoryRecord & ForgetCommitResult;
      }

      // Action: 'remember'
      const now = Date.now();
      const newId = `mem_${now}_${Math.random().toString(36).slice(2, 7)}`;
      const claimKey = params.claimKey ?? `claim_${now}`;

      // Check if existing active record with same claimKey exists in the same scope, supersede it
      const existing = this.cachedRecords.find(
        (r) =>
          r.status === 'active' &&
          r.claimKey === claimKey &&
          r.scope.vaultId === params.scope.vaultId &&
          r.scope.projectId === params.scope.projectId,
      );
      const supersedes: string[] = [];
      let revision = 1;
      if (existing) {
        existing.status = 'superseded';
        existing.revision += 1;
        supersedes.push(existing.id);
        revision = existing.revision;
      }

      const newRecord: MemoryRecord = {
        id: newId,
        revision,
        kind: params.kind ?? 'profile',
        scope: params.scope,
        claimKey,
        content: params.content ?? '',
        status: 'active',
        basis: 'explicit',
        evidence: [],
        observedAt: now,
        supersedes,
        conditions: params.conditions,
        outcome: params.outcome,
      };

      this.cachedRecords.push(newRecord);
      const nextGen = this.nextGenerationName(this.currentGen);
      await this.persistGeneration(nextGen);
      this.currentGen = nextGen;

      return newRecord as MemoryRecord & ForgetCommitResult;
    } finally {
      if (token) {
        await this.releaseWriterLock(token);
      }
    }
  }

  async commitDream(params: CommitDreamParams): Promise<DreamCommitResult> {
    this.assertInitialized();
    const token = await this.acquireWriterLock();
    try {
      let appliedCount = 0;
      let rejectedCount = 0;
      const now = Date.now();

      for (const prop of params.proposals) {
        // Validation 1: Forget ledger suppression
        if (
          this.isSuppressed({
            claimKey: prop.claimKey,
            content: prop.content,
          })
        ) {
          rejectedCount++;
          continue;
        }

        if (prop.action === 'no_op') {
          continue;
        }

        if (prop.action === 'add' || prop.action === 'merge' || prop.action === 'supersede') {
          // Check for existing record by claimKey in the same scope
          const existing = this.cachedRecords.find(
            (r) =>
              r.status === 'active' &&
              r.claimKey === prop.claimKey &&
              r.scope.vaultId === prop.scope.vaultId &&
              r.scope.projectId === prop.scope.projectId,
          );

          const supersedes: string[] = [];
          let revision = 1;
          if (existing) {
            existing.status = 'superseded';
            existing.revision += 1;
            supersedes.push(existing.id);
            revision = existing.revision;
          }

          const record: MemoryRecord = {
            id: prop.targetId ?? `mem_${now}_${Math.random().toString(36).slice(2, 7)}`,
            revision,
            kind: prop.kind,
            scope: prop.scope,
            claimKey: prop.claimKey,
            content: prop.content,
            status: 'active',
            basis: prop.basis ?? 'observed',
            evidence: prop.evidence,
            observedAt: now,
            validFrom: prop.validFrom,
            validUntil: prop.validUntil,
            reviewAfter: prop.reviewAfter,
            supersedes,
            conditions: prop.conditions,
            outcome: prop.outcome,
          };
          this.cachedRecords.push(record);
          appliedCount++;
        } else if (prop.action === 'contest' && prop.targetId) {
          const target = this.cachedRecords.find((r) => r.id === prop.targetId);
          if (target) {
            target.status = 'contested';
            target.revision += 1;
            appliedCount++;
          }
        } else if (prop.action === 'archive' && prop.targetId) {
          const target = this.cachedRecords.find((r) => r.id === prop.targetId);
          if (target) {
            target.status = 'archived';
            target.revision += 1;
            appliedCount++;
          }
        }
      }

      // Advance checkpoints
      if (params.adjudicatedEvents.fromEventId) {
        this.cachedCheckpoints.lastAdjudicatedEventId =
          params.adjudicatedEvents.toEventId ?? params.adjudicatedEvents.fromEventId;
        this.cachedCheckpoints.lastAdjudicatedTimestamp = now;
      }
      this.cachedCheckpoints.adjudicatedEventCount += params.adjudicatedEvents.eventCount;
      this.cachedCheckpoints.version += 1;

      // Update or insert job
      const jobIdx = this.cachedJobs.findIndex((j) => j.id === params.jobId);
      if (jobIdx >= 0) {
        this.cachedJobs[jobIdx].status = 'succeeded';
        this.cachedJobs[jobIdx].updatedAt = now;
      }

      const nextGen = this.nextGenerationName(this.currentGen);
      await this.persistGeneration(nextGen);
      this.currentGen = nextGen;

      return {
        appliedCount,
        rejectedCount,
        newGenRevision: nextGen,
      };
    } finally {
      if (token) {
        await this.releaseWriterLock(token);
      }
    }
  }

  async appendEpisode(episode: EpisodeRecord): Promise<void> {
    this.assertInitialized();
    const episodePath = `${this.baseDir}/episodes/${episode.id}.json`;
    if (await this.storage.exists(episodePath)) {
      return; // Already exists, immutable
    }
    await this.storage.writeFileAtomic(episodePath, JSON.stringify(episode, null, 2));
  }

  async getEpisode(id: string): Promise<EpisodeRecord | null> {
    this.assertInitialized();
    const episodePath = `${this.baseDir}/episodes/${id}.json`;
    if (!(await this.storage.exists(episodePath))) {
      return null;
    }
    try {
      const raw = await this.storage.readFile(episodePath);
      return JSON.parse(raw) as EpisodeRecord;
    } catch {
      return null;
    }
  }

  async listEpisodes(): Promise<EpisodeRecord[]> {
    this.assertInitialized();
    const files = await this.storage.listFiles(`${this.baseDir}/episodes`);
    const episodes: EpisodeRecord[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const episode = await this.getEpisode(file.replace(/\.json$/, ''));
      if (episode) episodes.push(episode);
    }
    return episodes.sort((a, b) => a.timestamp - b.timestamp);
  }

  async recordFeedback(feedback: MemoryFeedbackRecord): Promise<void> {
    this.assertInitialized();
    const feedbackPath = `${this.baseDir}/feedback/${feedback.id}.json`;
    await this.storage.writeFileAtomic(feedbackPath, JSON.stringify(feedback, null, 2));
  }

  async acquireWriterLock(): Promise<string | null> {
    return await this.storage.acquireLock(`${this.baseDir}/writer_lock`);
  }

  async releaseWriterLock(token: string): Promise<boolean> {
    return await this.storage.releaseLock(`${this.baseDir}/writer_lock`, token);
  }

  private async loadGeneration(genRev: string): Promise<void> {
    const genDir = `${this.baseDir}/generations/${genRev}`;
    const recordsPath = `${genDir}/records.json`;
    const jobsPath = `${genDir}/jobs.json`;
    const checkpointsPath = `${genDir}/checkpoints.json`;

    if (await this.storage.exists(recordsPath)) {
      const content = await this.storage.readFile(recordsPath);
      this.cachedRecords = JSON.parse(content) as MemoryRecord[];
    } else {
      this.cachedRecords = [];
    }

    if (await this.storage.exists(jobsPath)) {
      const content = await this.storage.readFile(jobsPath);
      this.cachedJobs = JSON.parse(content) as DreamJob[];
    } else {
      this.cachedJobs = [];
    }

    if (await this.storage.exists(checkpointsPath)) {
      const content = await this.storage.readFile(checkpointsPath);
      this.cachedCheckpoints = JSON.parse(content) as CheckpointsState;
    } else {
      this.cachedCheckpoints = { adjudicatedEventCount: 0, version: 1 };
    }
  }

  private async persistGeneration(genRev: string): Promise<void> {
    const genDir = `${this.baseDir}/generations/${genRev}`;
    await this.storage.mkdir(genDir);

    await this.storage.writeFileAtomic(
      `${genDir}/records.json`,
      JSON.stringify(this.cachedRecords, null, 2),
    );
    await this.storage.writeFileAtomic(
      `${genDir}/jobs.json`,
      JSON.stringify(this.cachedJobs, null, 2),
    );
    await this.storage.writeFileAtomic(
      `${genDir}/checkpoints.json`,
      JSON.stringify(this.cachedCheckpoints, null, 2),
    );

    // Atomically point CURRENT to new generation
    const pointer: CurrentPointer = {
      currentRevision: genRev,
      updatedAt: Date.now(),
      writerFencingToken: `fencing_${Date.now()}`,
    };
    await this.storage.writeFileAtomic(
      `${this.baseDir}/CURRENT`,
      JSON.stringify(pointer, null, 2),
    );
  }

  private async loadForgetLedger(): Promise<void> {
    const files = await this.storage.listFiles(`${this.baseDir}/forget-ledger`);
    this.cachedForgetLedger = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await this.storage.readFile(`${this.baseDir}/forget-ledger/${file}`);
        this.cachedForgetLedger.push(JSON.parse(raw) as ForgetEntry);
      } catch {
        // Skip corrupt entry
      }
    }
  }

  private nextGenerationName(current: string): string {
    const num = parseInt(current.replace(/^gen_/, ''), 10);
    const nextNum = Number.isFinite(num) ? num + 1 : 1;
    return `gen_${String(nextNum).padStart(6, '0')}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return `hash_${hash.toString(16)}`;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('MemoryRepository is not initialized. Call initialize() first.');
    }
  }
}
