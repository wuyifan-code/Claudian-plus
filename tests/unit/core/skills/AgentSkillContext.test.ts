import type { AgentRole } from '@/core/skills/AgentSkillContext';
import { createAgentSkillContext, EMPTY_AGENT_SKILL_CONTEXT } from '@/core/skills/AgentSkillContext';
import type { AgentSkillSummary } from '@/core/skills/AgentSkillRegistry';

function makeSkill(name: string): AgentSkillSummary {
  return {
    name,
    description: `${name} description`,
    source: { kind: 'vault-agents', rootPath: '.agents/skills', scope: 'vault', strictDirectoryName: true },
    scope: 'vault',
    directoryPath: `.agents/skills/${name}`,
    filePath: `.agents/skills/${name}/SKILL.md`,
    revision: 'rev-' + name,
  };
}

describe('AgentSkillContext', () => {
  it('exposes an empty context with no available skills', () => {
    expect(EMPTY_AGENT_SKILL_CONTEXT.availableSkills).toEqual([]);
    expect(EMPTY_AGENT_SKILL_CONTEXT.requestedSkills).toEqual([]);
    expect(EMPTY_AGENT_SKILL_CONTEXT.registryRevision).toBeNull();
  });

  it('builds a context with the requested role and skills', () => {
    const summary = makeSkill('reviewer');
    const context = createAgentSkillContext('chat', [summary], {
      registryRevision: 'rev-1',
      requestedSkills: ['reviewer'],
    });
    expect(context.role).toBe<AgentRole>('chat');
    expect(context.availableSkills).toEqual([summary]);
    expect(context.requestedSkills).toEqual(['reviewer']);
    expect(context.registryRevision).toBe('rev-1');
  });

  it('defaults to the chat role when none is provided', () => {
    const context = createAgentSkillContext('subagent', []);
    expect(context.role).toBe<AgentRole>('subagent');
    expect(context.availableSkills).toEqual([]);
  });
});
