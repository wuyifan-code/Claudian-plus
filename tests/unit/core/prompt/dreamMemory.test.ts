import {
  buildDreamPrompt,
  buildMicroDreamPrompt,
  DREAM_CATEGORY_WHITELIST,
  DREAM_DEFAULT_MAX_FACT_LENGTH,
  DREAM_DEFAULT_MAX_INPUT_CHARS,
  EMPTY_DREAM_MEMORY_RESULT,
  parseDreamMemoryResponse,
  parseMicroDreamResponse,
  sanitizeDreamResult,
} from '@/core/prompt/dreamMemory';


describe('dreamMemory prompt contract', () => {
  describe('buildDreamPrompt', () => {
    it('renders all input sections', () => {
      const prompt = buildDreamPrompt({
        logs: 'User: hi',
        existingMemories: '## User Preferences\n- Prefers dark mode',
        userProfile: '# 用户画像',
      });

      expect(prompt).toContain('SHORT-TERM LOGS');
      expect(prompt).toContain('EXISTING MEMORY');
      expect(prompt).toContain('USER PROFILE');
      expect(prompt).toContain('User: hi');
      expect(prompt).toContain('Prefers dark mode');
      expect(prompt).toContain('用户画像');
    });

    it('marks empty sections as none', () => {
      const prompt = buildDreamPrompt({
        logs: 'User: hi',
        existingMemories: '',
        userProfile: '',
      });

      expect(prompt).toContain('existingMemory: (none)');
      expect(prompt).toContain('userProfile: (none)');
    });

    it('truncates oversized sections at the cap', () => {
      const longText = 'x'.repeat(DREAM_DEFAULT_MAX_INPUT_CHARS + 100);
      const prompt = buildDreamPrompt({
        logs: longText,
        existingMemories: '',
        userProfile: '',
      });

      expect(prompt).toContain('x'.repeat(DREAM_DEFAULT_MAX_INPUT_CHARS));
      expect(prompt).not.toContain('x'.repeat(DREAM_DEFAULT_MAX_INPUT_CHARS + 100));
      expect(prompt).toContain('...');
    });
  });

  describe('parseDreamMemoryResponse', () => {
    it('parses a plain JSON response', () => {
      const result = parseDreamMemoryResponse(JSON.stringify({
        newFacts: [{ category: 'User Preferences', content: 'Prefers dark mode' }],
        profileUpdates: [{ section: '偏好', content: 'Prefers dark mode' }],
        insights: [{ content: 'User values privacy' }],
      }));

      expect(result.newFacts).toEqual([
        { category: 'User Preferences', content: 'Prefers dark mode' },
      ]);
      expect(result.profileUpdates).toEqual([
        { section: '偏好', content: 'Prefers dark mode' },
      ]);
      expect(result.insights).toEqual([{ content: 'User values privacy' }]);
    });

    it('parses JSON wrapped in markdown code fences', () => {
      const result = parseDreamMemoryResponse([
        '```json',
        JSON.stringify({ newFacts: [{ category: 'Rules', content: 'Always test' }] }),
        '```',
      ].join('\n'));

      expect(result.newFacts).toEqual([{ category: 'Rules', content: 'Always test' }]);
      expect(result.profileUpdates).toEqual([]);
      expect(result.insights).toEqual([]);
    });

    it('parses JSON with leading commentary', () => {
      const result = parseDreamMemoryResponse(
        `Here are the extracted memories:\n${JSON.stringify({ newFacts: [] })}`,
      );

      expect(result.newFacts).toEqual([]);
    });

    it('extracts the first JSON object embedded in prose', () => {
      const result = parseDreamMemoryResponse([
        'prefix text',
        '{"newFacts": [{"category": "Tools", "content": "Uses Obsidian"}]}',
        'suffix text',
      ].join('\n'));

      expect(result.newFacts).toEqual([{ category: 'Tools', content: 'Uses Obsidian' }]);
    });

    it('returns empty result for malformed JSON', () => {
      expect(parseDreamMemoryResponse('not json at all')).toEqual(EMPTY_DREAM_MEMORY_RESULT);
      expect(parseDreamMemoryResponse('{"newFacts": [}')).toEqual(EMPTY_DREAM_MEMORY_RESULT);
      expect(parseDreamMemoryResponse('')).toEqual(EMPTY_DREAM_MEMORY_RESULT);
    });

    it('skips invalid entries and trims content', () => {
      const result = parseDreamMemoryResponse(JSON.stringify({
        newFacts: [
          { category: 'Tools', content: '  Uses Obsidian  ' },
          { category: '', content: 'Missing category' },
          { content: 'Missing category field' },
          'not an object',
          null,
        ],
        profileUpdates: [{ section: '偏好', content: '' }],
        insights: ['valid insight', '', 42],
      }));

      expect(result.newFacts).toEqual([{ category: 'Tools', content: 'Uses Obsidian' }]);
      expect(result.profileUpdates).toEqual([]);
      expect(result.insights).toEqual([{ content: 'valid insight' }]);
    });
  });

  describe('sanitizeDreamResult', () => {
    it('drops facts with non-whitelisted categories', () => {
      const result = sanitizeDreamResult({
        newFacts: [
          { category: 'User Preferences', content: 'ok' },
          { category: 'Secrets', content: 'drop me' },
        ],
        profileUpdates: [],
        insights: [],
      });

      expect(result.newFacts).toEqual([{ category: 'User Preferences', content: 'ok' }]);
    });

    it('drops profile updates with unknown sections', () => {
      const result = sanitizeDreamResult({
        newFacts: [],
        profileUpdates: [
          { section: '偏好', content: 'ok' },
          { section: 'Soul', content: 'drop me' },
        ],
        insights: [],
      });

      expect(result.profileUpdates).toEqual([{ section: '偏好', content: 'ok' }]);
    });

    it('caps counts and content length', () => {
      const result = sanitizeDreamResult({
        newFacts: [
          { category: 'Rules', content: 'a'.repeat(DREAM_DEFAULT_MAX_FACT_LENGTH + 50) },
          { category: 'Rules', content: 'second' },
          { category: 'Rules', content: 'third' },
        ],
        profileUpdates: [],
        insights: [
          { content: 'i1' },
          { content: 'i2' },
          { content: 'i3' },
          { content: 'i4' },
        ],
      }, {
        maxNewFacts: 2,
        maxInsights: 3,
      });

      expect(result.newFacts).toHaveLength(2);
      expect(result.newFacts[0].content).toHaveLength(DREAM_DEFAULT_MAX_FACT_LENGTH);
      expect(result.insights).toHaveLength(3);
    });

    it('preserves the whitelist against dream output', () => {
      expect(DREAM_CATEGORY_WHITELIST).toContain('User Preferences');
      expect(DREAM_CATEGORY_WHITELIST).toContain('Project Context');
      expect(DREAM_CATEGORY_WHITELIST).toContain('General');
    });
  });

  describe('Dreaming V3 Micro-Dream contract', () => {
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

