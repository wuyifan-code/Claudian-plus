import {
  ANTIGRAVITY_FORBIDDEN_FLAGS,
  AntigravityCliMissingError,
  AntigravityLaunchSpecError,
  assertNoForbiddenAntigravityFlags,
  buildAntigravityLaunchSpec,
  requireAntigravityCliPath,
} from '@/providers/antigravity/runtime/AntigravityLaunchSpec';

const RESOLVED_CLI = 'C:\\Users\\user\\AppData\\Local\\agy\\bin\\agy.EXE';

const baseParams = {
  command: RESOLVED_CLI,
  cwd: 'D:\\Vault',
  prompt: 'Reply with exactly READY.',
};

describe('AntigravityLaunchSpec', () => {
  describe('print mode (verified A0 shape)', () => {
    it('builds a fresh print turn with stream-json output and the default print timeout', () => {
      const spec = buildAntigravityLaunchSpec({ ...baseParams });

      expect(spec.args).toEqual([
        '-p',
        'Reply with exactly READY.',
        '--output-format',
        'stream-json',
        '--print-timeout',
        '30s',
      ]);
      expect(spec.command).toBe(RESOLVED_CLI);
      expect(spec.cwd).toBe('D:\\Vault');
      expect(spec.mode).toBe('print');
      expect(spec.conversationId).toBeNull();
      expect(spec.env).toBe(process.env);
    });

    it('resumes only by explicit conversation id and never emits -c/--continue', () => {
      const spec = buildAntigravityLaunchSpec({
        ...baseParams,
        conversationId: 'e848aee0-50a4-4889-9b1b-697878871fa2',
        model: 'gemini-3.8-flash-low',
      });

      expect(spec.args).toEqual([
        '-p',
        'Reply with exactly READY.',
        '--output-format',
        'stream-json',
        '--print-timeout',
        '30s',
        '--conversation',
        'e848aee0-50a4-4889-9b1b-697878871fa2',
        '--model',
        'gemini-3.8-flash-low',
      ]);
      expect(spec.conversationId).toBe('e848aee0-50a4-4889-9b1b-697878871fa2');
      expect(spec.args).not.toContain('-c');
      expect(spec.args).not.toContain('--continue');
    });

    it('refuses to resume without a conversation id', () => {
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, conversationId: '' }))
        .toThrow(AntigravityLaunchSpecError);
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, conversationId: '   ' }))
        .toThrow(AntigravityLaunchSpecError);
    });

    it('rejects malformed conversation ids instead of passing them to argv', () => {
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, conversationId: 'has spaces' }))
        .toThrow(AntigravityLaunchSpecError);
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, conversationId: '-model' }))
        .toThrow(AntigravityLaunchSpecError);
    });

    it('requires a non-empty prompt in print mode', () => {
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, prompt: '' }))
        .toThrow(AntigravityLaunchSpecError);
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, prompt: '   ' }))
        .toThrow(AntigravityLaunchSpecError);
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, prompt: undefined as unknown as string }))
        .toThrow(AntigravityLaunchSpecError);
    });

    it('preserves multi-line prompt content verbatim', () => {
      const prompt = 'line one\nline two\n- not a flag line';
      const spec = buildAntigravityLaunchSpec({ ...baseParams, prompt });

      expect(spec.args).toContain(prompt);
    });

    it('passes the model through and accepts a custom print timeout', () => {
      const spec = buildAntigravityLaunchSpec({
        ...baseParams,
        model: 'claude-sonnet-4-6',
        printTimeout: '60s',
      });

      expect(spec.args).toContain('--model');
      expect(spec.args).toContain('claude-sonnet-4-6');
      expect(spec.args).toContain('60s');
    });

    it('omits the model flag when no model is set and rejects flag-like models', () => {
      expect(buildAntigravityLaunchSpec({ ...baseParams, model: null }).args).not.toContain('--model');
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, model: '-p' }))
        .toThrow(AntigravityLaunchSpecError);
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, model: 'two models' }))
        .toThrow(AntigravityLaunchSpecError);
    });
  });

  describe('persistent-stdin mode (docs-only, off by default)', () => {
    it('is opt-in: the default mode stays print', () => {
      expect(buildAntigravityLaunchSpec({ ...baseParams }).mode).toBe('print');
    });

    it('builds the A0-observed stdin startup args without -p and without a print timeout', () => {
      const spec = buildAntigravityLaunchSpec({
        ...baseParams,
        mode: 'persistent-stdin',
        prompt: undefined,
        model: 'gemini-3.8-flash-low',
      });

      expect(spec.args).toEqual([
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--model',
        'gemini-3.8-flash-low',
      ]);
    });

    it('rejects a prompt in persistent mode instead of silently dropping it', () => {
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, mode: 'persistent-stdin' }))
        .toThrow(AntigravityLaunchSpecError);
    });

    it('allows explicit conversation binding in persistent mode', () => {
      const spec = buildAntigravityLaunchSpec({
        ...baseParams,
        mode: 'persistent-stdin',
        prompt: undefined,
        conversationId: 'e848aee0-50a4-4889-9b1b-697878871fa2',
      });

      expect(spec.args).toContain('--conversation');
      expect(spec.conversationId).toBe('e848aee0-50a4-4889-9b1b-697878871fa2');
    });
  });

  describe('safety guards', () => {
    it('rejects the permission bypass flag in every form', () => {
      expect(() => assertNoForbiddenAntigravityFlags(['--dangerously-skip-permissions']))
        .toThrow(AntigravityLaunchSpecError);
      expect(() => assertNoForbiddenAntigravityFlags(['--dangerously-skip-permissions=true']))
        .toThrow(AntigravityLaunchSpecError);
      expect(() => assertNoForbiddenAntigravityFlags(['--output-format', 'json', '--dangerously-skip-permissions']))
        .toThrow(/dangerously/);
    });

    it('rejects continue-most-recent flags that would cross-talk between tabs', () => {
      expect(() => assertNoForbiddenAntigravityFlags(['-c'])).toThrow(AntigravityLaunchSpecError);
      expect(() => assertNoForbiddenAntigravityFlags(['--continue'])).toThrow(AntigravityLaunchSpecError);
      expect(() => assertNoForbiddenAntigravityFlags(['--continue=5'])).toThrow(AntigravityLaunchSpecError);
    });

    it('accepts ordinary argument arrays', () => {
      expect(() => assertNoForbiddenAntigravityFlags([
        '-p',
        'hello',
        '--output-format',
        'stream-json',
      ])).not.toThrow();
    });

    it('allows --dangerously-skip-permissions when explicitly permitted', () => {
      expect(() => assertNoForbiddenAntigravityFlags(
        ['--dangerously-skip-permissions'],
        { allowDangerouslySkipPermissions: true },
      )).not.toThrow();
      const spec = buildAntigravityLaunchSpec({
        ...baseParams,
        allowDangerouslySkipPermissions: true,
      });
      expect(spec.args).toContain('--dangerously-skip-permissions');
    });

    it('passes addDirs via --add-dir', () => {
      const spec = buildAntigravityLaunchSpec({
        ...baseParams,
        addDirs: ['D:\\Vault', 'D:\\Vault\\Subdir'],
      });
      expect(spec.args).toEqual(expect.arrayContaining([
        '--add-dir', 'D:\\Vault',
        '--add-dir', 'D:\\Vault\\Subdir',
      ]));
    });

    it('declares the forbidden flag set used by the guard', () => {
      expect(ANTIGRAVITY_FORBIDDEN_FLAGS).toContain('--dangerously-skip-permissions');
      expect(ANTIGRAVITY_FORBIDDEN_FLAGS).toContain('-c');
      expect(ANTIGRAVITY_FORBIDDEN_FLAGS).toContain('--continue');
    });

    it('never emits forbidden flags in any default built spec', () => {
      const specs = [
        buildAntigravityLaunchSpec({ ...baseParams }),
        buildAntigravityLaunchSpec({
          ...baseParams,
          conversationId: 'e848aee0-50a4-4889-9b1b-697878871fa2',
          model: 'gemini-3.8-flash-low',
        }),
        buildAntigravityLaunchSpec({ ...baseParams, mode: 'persistent-stdin', prompt: undefined }),
      ];

      for (const spec of specs) {
        expect(() => assertNoForbiddenAntigravityFlags(spec.args)).not.toThrow();
      }
    });
  });

  describe('typed CLI errors', () => {
    it('throws AntigravityCliMissingError for a blank resolved command', () => {
      for (const command of ['', '   ']) {
        const attempt = () => buildAntigravityLaunchSpec({ ...baseParams, command });
        expect(attempt).toThrow(AntigravityCliMissingError);
        expect(attempt).toThrow(/agy/);
      }
    });

    it('requires a non-empty cwd', () => {
      expect(() => buildAntigravityLaunchSpec({ ...baseParams, cwd: '' }))
        .toThrow(AntigravityLaunchSpecError);
    });

    it('names the typed errors for boundary handling', () => {
      expect(new AntigravityCliMissingError()).toMatchObject({ name: 'AntigravityCliMissingError' });
      expect(new AntigravityLaunchSpecError('detail'))
        .toMatchObject({ name: 'AntigravityLaunchSpecError', message: 'detail' });
    });

    it('requireAntigravityCliPath returns trimmed paths and throws a typed error otherwise', () => {
      expect(requireAntigravityCliPath('  /opt/agy  ')).toBe('/opt/agy');
      expect(() => requireAntigravityCliPath(null)).toThrow(AntigravityCliMissingError);
      expect(() => requireAntigravityCliPath(undefined)).toThrow(AntigravityCliMissingError);
      expect(() => requireAntigravityCliPath('')).toThrow(AntigravityCliMissingError);
      expect(() => requireAntigravityCliPath('  ')).toThrow(AntigravityCliMissingError);
    });
  });
});
