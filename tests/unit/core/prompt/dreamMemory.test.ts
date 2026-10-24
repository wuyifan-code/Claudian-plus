import {
  buildMicroDreamPrompt,
  parseMicroDreamResponse,
} from '@/core/prompt/dreamMemory';


describe('dreamMemory prompt contract', () => {
  describe('Micro-Dream contract', () => {
    it('builds micro-dream prompt with trajectory and existing rules', () => {
      const prompt = buildMicroDreamPrompt({
        trajectoryText: 'User: Use pnpm only\nAssistant: Understood.',
        existingRulesText: '- Rule 1',
        projectContext: 'Vault: obsidian-plugin',
      });

      expect(prompt).toContain('SESSION TRAJECTORY');
      expect(prompt).toContain('User: Use pnpm only');
      expect(prompt).toContain('CURRENT ACTIVE RULES');
      expect(prompt).toContain('- Rule 1');
      expect(prompt).toContain('PROJECT CONTEXT');
    });

    it('parses valid micro-dream response', () => {
      const response = JSON.stringify({
        rules: [
          {
            category: 'coding_habit',
            scope: 'global',
            content: 'Always use pnpm over npm',
            rationale: 'User command',
            confidence: 0.95,
          },
          {
            category: 'project_rule',
            scope: 'project',
            content: 'No circular deps in core',
            rationale: 'Observed architecture error',
            confidence: 0.9,
          },
        ],
      });

      const parsed = parseMicroDreamResponse(response);
      expect(parsed.rules).toHaveLength(2);
      expect(parsed.rules[0].category).toBe('coding_habit');
      expect(parsed.rules[0].scope).toBe('global');
      expect(parsed.rules[1].category).toBe('project_rule');
      expect(parsed.rules[1].scope).toBe('project');
    });

    it('filters out invalid categories and returns empty on bad JSON', () => {
      const invalid = JSON.stringify({
        rules: [
          { category: 'invalid_cat', content: 'hello' },
          { category: 'user_preference', content: '' },
        ],
      });
      expect(parseMicroDreamResponse(invalid).rules).toEqual([]);
      expect(parseMicroDreamResponse('not json').rules).toEqual([]);
    });
  });
});
