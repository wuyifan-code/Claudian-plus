import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type { SlashCommand } from '../../../core/types';
import {
  parsedToSlashCommand,
  scanVaultSkillMarkdown,
  serializeCommand,
} from '../../../utils/slashCommand';

export const SKILLS_PATH = '.claude/skills';

export class SkillStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async loadAll(): Promise<SlashCommand[]> {
    const scanned = await scanVaultSkillMarkdown(this.adapter, SKILLS_PATH);

    return scanned.map((skill) => ({
      ...parsedToSlashCommand(skill.parsed, {
        id: `skill-${skill.name}`,
        name: skill.name,
        source: 'user',
      }),
      kind: 'skill',
    }));
  }

  async save(skill: SlashCommand): Promise<void> {
    const name = skill.name;
    const dirPath = `${SKILLS_PATH}/${name}`;
    const filePath = `${dirPath}/SKILL.md`;

    await this.adapter.ensureFolder(dirPath);
    await this.adapter.write(filePath, serializeCommand(skill));
  }

  async delete(skillId: string): Promise<void> {
    const name = skillId.replace(/^skill-/, '');
    const dirPath = `${SKILLS_PATH}/${name}`;
    const filePath = `${dirPath}/SKILL.md`;
    await this.adapter.delete(filePath);
    await this.adapter.deleteFolder(dirPath);
  }
}
