/**
 * Expands `@<agentId> (agent)` mention markers into full agent definitions.
 * The mention dropdown inserts only the marker text; DSH agents have no
 * native agent registry, so the runtime resolves the mentioned vault agent
 * file and appends its instructions to the prompt.
 */
export interface DshMentionAgent {
  description: string;
  fileContent: string;
  id: string;
  name: string;
}

const AGENT_MENTION_PATTERN = /@([A-Za-z0-9_-]+)\s*\(agent\)/g;

export function expandAgentMentions(
  prompt: string,
  agents: ReadonlyMap<string, DshMentionAgent>,
): string {
  const mentioned = new Set<string>();
  for (const match of prompt.matchAll(AGENT_MENTION_PATTERN)) {
    const agentId = match[1];
    if (agents.has(agentId)) {
      mentioned.add(agentId);
    }
  }

  if (mentioned.size === 0) {
    return prompt;
  }

  const sections: string[] = [];
  for (const agentId of mentioned) {
    const agent = agents.get(agentId)!;
    sections.push([
      `<agent id="${agent.id}" name="${agent.name}">`,
      `Description: ${agent.description}`,
      '',
      agent.fileContent.trim(),
      '</agent>',
    ].join('\n'));
  }

  return `${prompt}\n\n${sections.join('\n\n')}`;
}
