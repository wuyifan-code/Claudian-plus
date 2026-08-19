export interface AgentSkillDocument {
  name: string;
  description: string;
  instructions: string;
  frontmatter: Record<string, unknown>;
  directoryPath: string;
  filePath: string;
  revision: string;
  /** 'vault' for skills in the vault root; 'home' for skills in the user home (~/.agents/skills/). */
  scope?: 'vault' | 'home';
}

export interface AgentSkillInput {
  name: string;
  description: string;
  instructions: string;
}

export interface AgentSkillDiagnostic {
  directoryPath: string;
  message: string;
}

export interface AgentSkillListResult {
  skills: AgentSkillDocument[];
  diagnostics: AgentSkillDiagnostic[];
}
