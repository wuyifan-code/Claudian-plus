import type { AgentSkillSummary } from './AgentSkillRegistry';

export type AgentRole =
  | 'chat'
  | 'subagent'
  | 'title'
  | 'instruction-refine'
  | 'dream';

export interface AgentSkillContext {
  role: AgentRole;
  /** Revision of the registry snapshot the summary list was loaded from. */
  registryRevision: string | null;
  /** Lightweight list of skills the agent can call. */
  availableSkills: AgentSkillSummary[];
  /** Names of skills the user explicitly attached for this turn. */
  requestedSkills: string[];
}

export const EMPTY_AGENT_SKILL_CONTEXT: AgentSkillContext = {
  role: 'chat',
  registryRevision: null,
  availableSkills: [],
  requestedSkills: [],
};

export function createAgentSkillContext(
  role: AgentRole,
  availableSkills: AgentSkillSummary[],
  options: { registryRevision?: string | null; requestedSkills?: string[] } = {},
): AgentSkillContext {
  return {
    role,
    registryRevision: options.registryRevision ?? null,
    availableSkills,
    requestedSkills: options.requestedSkills ?? [],
  };
}
