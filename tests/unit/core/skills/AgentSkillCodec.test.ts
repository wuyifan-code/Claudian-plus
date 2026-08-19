import { AgentSkillCodecError, parseAgentSkillMarkdown } from '@/core/skills/AgentSkillCodec';

function skillMarkdown(name: string, description: string, instructions = 'Do the work.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${instructions}\n`;
}

describe('AgentSkillCodec', () => {
  describe('parseAgentSkillMarkdown', () => {
    it('rejects missing frontmatter', () => {
      expect(() => parseAgentSkillMarkdown('plain text only', 'name', { strictDirectoryName: true }))
        .toThrow(AgentSkillCodecError);
    });

    it('rejects frontmatter missing the name field', () => {
      const content = `---\ndescription: Missing name\n---\nbody\n`;
      expect(() => parseAgentSkillMarkdown(content, 'name', { strictDirectoryName: true }))
        .toThrow(/name/);
    });

    it('rejects invalid skill names', () => {
      const content = skillMarkdown('Invalid-Name', 'desc');
      expect(() => parseAgentSkillMarkdown(content, 'invalid-name', { strictDirectoryName: true }))
        .toThrow(AgentSkillCodecError);
    });

    it('enforces vault directory-name equality when strictDirectoryName is true', () => {
      const content = skillMarkdown('a-stock-analysis', 'desc');
      expect(() => parseAgentSkillMarkdown(content, 'a-stock-analysis-1.0.0', { strictDirectoryName: true }))
        .toThrow(/must match its directory/);
    });

    it('allows versioned home directory names when strictDirectoryName is false', () => {
      const content = skillMarkdown('a-stock-analysis', 'desc');
      const parsed = parseAgentSkillMarkdown(content, 'a-stock-analysis-1.0.0', {
        strictDirectoryName: false,
      });
      expect(parsed.name).toBe('a-stock-analysis');
    });

    it('normalizes line endings in the instructions body', () => {
      const content = '---\nname: ok\ndescription: d\n---\r\nfirst line\r\nsecond line\r\n';
      const parsed = parseAgentSkillMarkdown(content, 'ok');
      expect(parsed.instructions).toBe('first line\nsecond line');
    });
  });
});
