import type { ConsciousnessEngine } from '../../ConsciousnessEngine';
import type { MemoryStore } from '../../MemoryStore';
import type { MindStore } from '../../MindStore';
import type { MemoryRepository } from '../MemoryRepository';
import type { DreamProposal, EvidenceRef, MemoryKind } from '../types';

export interface LegacyMemoryMigratorOptions {
  repository: MemoryRepository;
  memoryStore?: MemoryStore | null;
  mindStore?: MindStore | null;
  consciousness?: ConsciousnessEngine | null;
  vaultId: string;
}

export interface MigrationResult {
  migratedCount: number;
  alreadyMigrated: boolean;
}

export class LegacyMemoryMigrator {
  private readonly repo: MemoryRepository;
  private readonly memoryStore?: MemoryStore | null;
  private readonly mindStore?: MindStore | null;
  private readonly consciousness?: ConsciousnessEngine | null;
  private readonly vaultId: string;

  constructor(options: LegacyMemoryMigratorOptions) {
    this.repo = options.repository;
    this.memoryStore = options.memoryStore;
    this.mindStore = options.mindStore;
    this.consciousness = options.consciousness;
    this.vaultId = options.vaultId;
  }

  async migrate(): Promise<MigrationResult> {
    if (await this.repo.hasMigrationRun('legacy_v2')) {
      return { migratedCount: 0, alreadyMigrated: true };
    }

    const proposals: DreamProposal[] = [];

    // 1. Migrate MemoryStore entries (.claudian-plus/memory.md)
    if (this.memoryStore) {
      try {
        const memoryEntries = await this.memoryStore.load();
        for (const entry of memoryEntries) {
          const content = entry.content?.trim();
          if (!content) continue;

          if (this.repo.isSuppressed({ content })) {
            continue;
          }

          const kind: MemoryKind = entry.category?.toLowerCase().includes('project')
            ? 'project_state'
            : 'profile';

          const evidence: EvidenceRef[] = [
            {
              rootEventId: `legacy_mem_${entry.id}`,
              eventRevision: '1',
              providerId: 'legacy',
              conversationId: 'legacy',
              messageId: 'legacy',
              span: { start: 0, end: content.length },
              sourceClass: 'import',
            },
          ];

          proposals.push({
            action: 'add',
            kind,
            claimKey: `legacy.memory.${this.simpleSlug(content.slice(0, 20))}`,
            content,
            scope: { vaultId: this.vaultId },
            basis: 'legacy',
            evidence,
          });
        }
      } catch {
        // Safe fallback
      }
    }

    // 2. Migrate MindStore durable rules
    if (this.mindStore) {
      try {
        const durableRules = await this.mindStore.listDurable();
        for (const rule of durableRules) {
          const content = rule.content?.trim();
          if (!content) continue;

          if (this.repo.isSuppressed({ content })) {
            continue;
          }

          let kind: MemoryKind = 'profile';
          if (rule.category === 'project_rule') {
            kind = 'project_state';
          } else if (rule.category === 'coding_habit' || rule.category === 'correction_rule') {
            kind = 'lesson';
          }

          const evidence: EvidenceRef[] = [
            {
              rootEventId: `legacy_mind_${rule.id}`,
              eventRevision: '1',
              providerId: 'legacy',
              conversationId: 'legacy',
              messageId: 'legacy',
              span: { start: 0, end: content.length },
              sourceClass: 'import',
            },
          ];

          proposals.push({
            action: 'add',
            kind,
            claimKey: `legacy.mind.${this.simpleSlug(content.slice(0, 20))}`,
            content,
            scope: { vaultId: this.vaultId },
            basis: 'legacy',
            evidence,
            conditions: rule.tags,
            outcome: rule.category === 'correction_rule' ? 'succeeded' : undefined,
          });
        }
      } catch {
        // Safe fallback
      }
    }

    // 3. Migrate Consciousness user profile (USER.md)
    if (this.consciousness) {
      try {
        const userProfile = await this.consciousness.getUserProfile();
        if (userProfile) {
          const content = userProfile.trim();
          if (content && !this.repo.isSuppressed({ content })) {
            const evidence: EvidenceRef[] = [
              {
                rootEventId: 'legacy_user_profile',
                eventRevision: '1',
                providerId: 'legacy',
                conversationId: 'legacy',
                messageId: 'legacy',
                span: { start: 0, end: content.length },
                sourceClass: 'import',
              },
            ];

            proposals.push({
              action: 'add',
              kind: 'profile',
              claimKey: 'legacy.profile.user_md',
              content,
              scope: { vaultId: this.vaultId },
              basis: 'legacy',
              evidence,
            });
          }
        }
      } catch {
        // Safe fallback
      }
    }

    const currentGen = await this.repo.getCurrentGeneration();
    const commitResult = await this.repo.commitDream({
      jobId: 'migration_legacy_v2',
      proposals,
      adjudicatedEvents: { eventCount: 0 },
      expectedGenRevision: currentGen,
    });

    await this.repo.recordMigration('legacy_v2', { count: commitResult.appliedCount });

    return {
      migratedCount: commitResult.appliedCount,
      alreadyMigrated: false,
    };
  }

  private simpleSlug(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
      .slice(0, 30)
      .replace(/^_+|_+$/g, '');
  }
}
