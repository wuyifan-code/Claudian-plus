import { type DshMentionAgent,expandAgentMentions } from '@/providers/dsh/runtime/expandAgentMentions';

const AGENTS = new Map<string, DshMentionAgent>([
  ['researcher', {
    description: 'Deep research specialist',
    fileContent: 'You do deep research.',
    id: 'researcher',
    name: 'researcher',
  }],
  ['builder', {
    description: 'Builds features',
    fileContent: 'You build features.',
    id: 'builder',
    name: 'builder',
  }],
]);

describe('expandAgentMentions', () => {
  it('leaves prompts without agent mentions untouched', () => {
    const prompt = 'Explain this code';
    expect(expandAgentMentions(prompt, AGENTS)).toBe(prompt);
  });

  it('appends mentioned agent definitions as XML sections', () => {
    const prompt = 'Use @researcher (agent) to investigate';
    const expanded = expandAgentMentions(prompt, AGENTS);

    expect(expanded).toContain('Use @researcher (agent) to investigate');
    expect(expanded).toContain('<agent id="researcher" name="researcher">');
    expect(expanded).toContain('Description: Deep research specialist');
    expect(expanded).toContain('You do deep research.');
    expect(expanded).toContain('</agent>');
  });

  it('expands multiple distinct mentions', () => {
    const expanded = expandAgentMentions('Ask @researcher (agent) and @builder (agent)', AGENTS);
    expect(expanded).toContain('<agent id="researcher"');
    expect(expanded).toContain('<agent id="builder"');
  });

  it('ignores mentions of unknown agents', () => {
    const prompt = 'Ask @ghost (agent)';
    expect(expandAgentMentions(prompt, AGENTS)).toBe(prompt);
  });

  it('does not expand plain @-mentions without the (agent) marker', () => {
    const prompt = 'Mention @researcher in the notes';
    expect(expandAgentMentions(prompt, AGENTS)).toBe(prompt);
  });
});
