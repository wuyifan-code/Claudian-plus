import type { MemoryRecord } from './types';

/**
 * Renders active V2 records as the user-facing memory.md export view. The file
 * is a read mirror of the repository, refreshed after every commit; edits to
 * it are not read back. Kept intentionally simple: grouped by kind, scoped to
 * vault-level records first, then project-scoped ones.
 */

const KIND_SECTIONS: { kind: MemoryRecord['kind']; title: string }[] = [
  { kind: 'profile', title: 'User Preferences' },
  { kind: 'project_state', title: 'Project Context' },
  { kind: 'lesson', title: 'Lessons & Conventions' },
];

export function exportMemoryView(records: MemoryRecord[], generatedAt = Date.now()): string {
  const lines: string[] = [
    '# Claudian Plus Memory',
    '',
    'This file is a generated, read-only view of the plugin memory store.',
    `Last refreshed: ${new Date(generatedAt).toISOString()}`,
    '',
  ];

  for (const section of KIND_SECTIONS) {
    const sectionRecords = records.filter((r) => r.kind === section.kind);
    if (sectionRecords.length === 0) continue;
    lines.push(`## ${section.title}`, '');
    for (const rec of sectionRecords) {
      const scope = rec.scope.projectId ? ` (${rec.scope.projectId})` : '';
      lines.push(`- ${rec.content}${scope}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
