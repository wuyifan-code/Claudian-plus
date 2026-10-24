import { exportMemoryView } from '@/core/memory/v2/exportView';
import type { MemoryRecord } from '@/core/memory/v2/types';

function record(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: 'mem_1',
    revision: 1,
    kind: 'profile',
    scope: { vaultId: 'v' },
    claimKey: 'user.x',
    content: 'content',
    status: 'active',
    basis: 'explicit',
    evidence: [],
    observedAt: 0,
    supersedes: [],
    ...overrides,
  };
}

describe('exportMemoryView', () => {
  it('renders active records grouped by kind with a generated timestamp', () => {
    const text = exportMemoryView(
      [
        record({ content: 'Prefers Chinese', kind: 'profile' }),
        record({ content: 'Uses pnpm', kind: 'project_state', scope: { vaultId: 'v', projectId: 'repo' } }),
        record({ content: 'Run tests before commit', kind: 'lesson' }),
      ],
      1700000000000,
    );

    expect(text).toContain('# Claudian Plus Memory');
    expect(text).toContain('generated, read-only view');
    expect(text).toContain('## User Preferences');
    expect(text).toContain('- Prefers Chinese');
    expect(text).toContain('## Project Context');
    expect(text).toContain('- Uses pnpm (repo)');
    expect(text).toContain('## Lessons & Conventions');
    expect(text).toContain('- Run tests before commit');
  });

  it('omits empty sections', () => {
    const text = exportMemoryView([record({ kind: 'profile', content: 'Only a profile' })], 1);

    expect(text).toContain('## User Preferences');
    expect(text).not.toContain('## Project Context');
    expect(text).not.toContain('## Lessons & Conventions');
  });
});
