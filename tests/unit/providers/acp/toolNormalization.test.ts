import { AcpToolStreamAdapter } from '@/providers/acp';
import { createAcpToolNormalization } from '@/providers/acp/toolNormalization';

const OPENCODE_MAP = {
  bash: 'Bash',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  question: 'AskUserQuestion',
  read: 'Read',
  skill: 'Skill',
  task: 'Task',
  todowrite: 'TodoWrite',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  write: 'Write',
} as const;

const KIMI_MAP = {
  ...OPENCODE_MAP,
  agent: 'Task',
  editfile: 'Edit',
  fetchurl: 'WebFetch',
  readfile: 'Read',
  search: 'Grep',
  searchweb: 'WebSearch',
  shell: 'Bash',
  writefile: 'Write',
} as const;

const KIMI_TITLE_SPLITTER = (raw: string | null | undefined): string | undefined => {
  if (!raw) {
    return undefined;
  }
  const token = raw.split(/\s+/)[0]?.replace(/[:-]+$/, '').trim();
  return token && token.length > 0 ? token : undefined;
};

describe('createAcpToolNormalization.normalizeToolName', () => {
  it('maps canonical raw names through the supplied map', () => {
    const { normalizeToolName } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(normalizeToolName('bash')).toBe('Bash');
    expect(normalizeToolName('websearch')).toBe('WebSearch');
    expect(normalizeToolName('todowrite')).toBe('TodoWrite');
  });

  it('is case-insensitive and trims whitespace', () => {
    const { normalizeToolName } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(normalizeToolName('  BASH  ')).toBe('Bash');
    expect(normalizeToolName('WebSearch')).toBe('WebSearch');
    expect(normalizeToolName('\tRead\n')).toBe('Read');
  });

  it('resolves kimi alias keys when the map carries them', () => {
    const { normalizeToolName } = createAcpToolNormalization({
      toolNameByRawKey: KIMI_MAP,
    });

    expect(normalizeToolName('Shell')).toBe('Bash');
    expect(normalizeToolName('shell')).toBe('Bash');
    expect(normalizeToolName('ReadFile')).toBe('Read');
    expect(normalizeToolName('EditFile')).toBe('Edit');
    expect(normalizeToolName('SearchWeb')).toBe('WebSearch');
  });

  it('returns the raw name trimmed when the key is unknown', () => {
    const { normalizeToolName } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(normalizeToolName('custom_tool')).toBe('custom_tool');
    expect(normalizeToolName('  custom_tool  ')).toBe('custom_tool');
  });

  it('falls back to "tool" when the raw name is empty or whitespace-only', () => {
    const { normalizeToolName } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(normalizeToolName(undefined)).toBe('tool');
    expect(normalizeToolName('')).toBe('tool');
    expect(normalizeToolName('   ')).toBe('tool');
  });
});

describe('createAcpToolNormalization.resolveRawToolName', () => {
  it('prefers a known trimmed title (opencode-style full-title match)', () => {
    const { resolveRawToolName } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(resolveRawToolName(undefined, { kind: 'read', title: 'Read' }))
      .toBe('read');
    expect(resolveRawToolName(undefined, { kind: 'read', title: '  bash  ' }))
      .toBe('bash');
  });

  it('falls back to the current raw name when the title does not match a known tool', () => {
    const { resolveRawToolName } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      resolveRawToolName('write', { kind: 'read', title: 'some/path.md' }),
    ).toBe('write');
  });

  it('falls back to kind-based defaults when no current raw name and title is unknown', () => {
    const { resolveRawToolName } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(resolveRawToolName(undefined, { kind: 'execute' })).toBe('bash');
    expect(resolveRawToolName(undefined, { kind: 'fetch' })).toBe('webfetch');
    expect(resolveRawToolName(undefined, { kind: 'read' })).toBe('read');
    expect(resolveRawToolName(undefined, { kind: undefined, title: 'something' }))
      .toBe('something');
    expect(resolveRawToolName(undefined, { kind: undefined, title: undefined }))
      .toBe('tool');
    expect(resolveRawToolName(undefined, { kind: undefined, title: '   ' }))
      .toBe('tool');
  });

  it('honors a custom extractTitleToken strategy (kimi: split whitespace, strip trailing : and -)', () => {
    const { resolveRawToolName } = createAcpToolNormalization({
      toolNameByRawKey: KIMI_MAP,
      extractTitleToken: KIMI_TITLE_SPLITTER,
    });

    expect(resolveRawToolName(undefined, { title: 'Shell: ls -la' })).toBe('shell');
    expect(resolveRawToolName(undefined, { title: 'Bash: run tests' })).toBe('bash');
    expect(resolveRawToolName(undefined, { title: 'Read- file at path' })).toBe('read');
    expect(resolveRawToolName(undefined, { title: 'Glob' })).toBe('glob');
  });

  it('lets a known title token override the current raw name (kimi)', () => {
    const { resolveRawToolName } = createAcpToolNormalization({
      toolNameByRawKey: KIMI_MAP,
      extractTitleToken: KIMI_TITLE_SPLITTER,
    });

    expect(resolveRawToolName('readfile', { title: 'Shell: ls -la' }))
      .toBe('shell');
  });

  it('keeps the current raw name when the extracted title token is unknown (kimi)', () => {
    const { resolveRawToolName } = createAcpToolNormalization({
      toolNameByRawKey: KIMI_MAP,
      extractTitleToken: KIMI_TITLE_SPLITTER,
    });

    expect(resolveRawToolName('readfile', { title: 'Custom action' }))
      .toBe('readfile');
  });
});

describe('createAcpToolNormalization.normalizeToolInput', () => {
  it('returns the input unchanged for unknown raw names', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(normalizeToolInput('custom_tool', { foo: 'bar' })).toEqual({
      foo: 'bar',
    });
  });

  it('shapes question inputs into the AskUserQuestion renderer contract', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      normalizeToolInput('question', {
        questions: [
          {
            header: 'Tests',
            id: 'tests',
            multiple: true,
            options: [
              { description: 'Update the related tests', label: 'Yes' },
              { description: 'Skip test edits', label: 'No' },
            ],
            question: 'Update tests too?',
          },
        ],
      }),
    ).toEqual({
      questions: [
        {
          header: 'Tests',
          id: 'tests',
          multiSelect: true,
          options: [
            { description: 'Update the related tests', label: 'Yes' },
            { description: 'Skip test edits', label: 'No' },
          ],
          question: 'Update tests too?',
        },
      ],
    });
  });

  it('defaults question text, header, and id for malformed entries', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(normalizeToolInput('question', { questions: [{}] })).toEqual({
      questions: [
        {
          header: 'Q1',
          multiSelect: false,
          options: [],
          question: 'Question 1',
        },
      ],
    });
  });

  it('shapes todowrite inputs into the TodoWrite renderer contract', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      normalizeToolInput('todowrite', {
        todos: [
          { content: 'Ship feature', status: 'in_progress' },
          { content: 'Drop stale task', status: 'cancelled' },
          { active_form: 'Hand off', content: 'Wrap handoff', status: 'pending' },
        ],
      }),
    ).toEqual({
      todos: [
        { activeForm: 'Ship feature', content: 'Ship feature', status: 'in_progress' },
        { activeForm: 'Drop stale task', content: 'Drop stale task', status: 'completed' },
        { activeForm: 'Hand off', content: 'Wrap handoff', status: 'pending' },
      ],
    });
  });

  it('shapes read inputs with file_path, limit, and offset', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      normalizeToolInput('read', {
        filePath: '/vault/notes/today.md',
        limit: 50,
        offset: 10,
      }),
    ).toEqual({
      file_path: '/vault/notes/today.md',
      limit: 50,
      offset: 10,
    });
  });

  it('shapes write inputs with content and file_path', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      normalizeToolInput('write', { content: 'hello', file_path: '/x.md' }),
    ).toEqual({ content: 'hello', file_path: '/x.md' });
  });

  it('shapes edit inputs with old_string/new_string and replace_all aliases', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      normalizeToolInput('edit', {
        file_path: '/x.md',
        newString: 'new',
        oldString: 'old',
        replaceAll: true,
      }),
    ).toEqual({
      file_path: '/x.md',
      new_string: 'new',
      old_string: 'old',
      replace_all: true,
    });
  });

  it('shapes task inputs with the subagent contract', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      normalizeToolInput('task', {
        command: 'lint',
        description: 'Run lint',
        prompt: 'Lint the project',
        run_in_background: true,
        subagent_type: 'code-reviewer',
        task_id: 't-1',
      }),
    ).toEqual({
      command: 'lint',
      description: 'Run lint',
      prompt: 'Lint the project',
      run_in_background: true,
      subagent_type: 'code-reviewer',
      task_id: 't-1',
    });
  });

  it('shapes skill inputs using either skill or name field', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(normalizeToolInput('skill', { name: 'commit' })).toEqual({
      skill: 'commit',
    });
    expect(normalizeToolInput('skill', { skill: 'commit' })).toEqual({
      skill: 'commit',
    });
    expect(normalizeToolInput('skill', {})).toEqual({});
  });

  it('shapes websearch inputs into the WebSearch renderer contract', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      normalizeToolInput('websearch', {
        action: {
          queries: [
            'obsidian plugin API',
            'obsidian docs',
            'obsidian plugin API',
          ],
        },
      }),
    ).toEqual({
      actionType: 'search',
      query: 'obsidian plugin API',
      queries: ['obsidian plugin API', 'obsidian docs'],
    });

    expect(
      normalizeToolInput('websearch', {
        action: { url: 'https://example.com' },
      }),
    ).toEqual({ actionType: 'open_page', url: 'https://example.com' });

    expect(
      normalizeToolInput('websearch', {
        action: { pattern: 'tools', url: 'https://example.com/docs' },
      }),
    ).toEqual({
      actionType: 'find_in_page',
      pattern: 'tools',
      url: 'https://example.com/docs',
    });
  });

  it('honors extra file_path aliases (kimi: input.path)', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: KIMI_MAP,
      extraFilePathInputKeys: ['path'],
    });

    expect(
      normalizeToolInput('ReadFile', { path: '/vault/a.md' }),
    ).toEqual({ file_path: '/vault/a.md' });

    expect(
      normalizeToolInput('WriteFile', {
        content: 'hello',
        path: '/vault/b.md',
      }),
    ).toEqual({ content: 'hello', file_path: '/vault/b.md' });

    expect(
      normalizeToolInput('EditFile', {
        newString: 'new',
        oldString: 'old',
        path: '/vault/c.md',
      }),
    ).toEqual({
      file_path: '/vault/c.md',
      new_string: 'new',
      old_string: 'old',
    });
  });

  it('ignores extra file_path aliases when extraFilePathInputKeys is not configured', () => {
    const { normalizeToolInput } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(normalizeToolInput('read', { path: '/vault/a.md' })).toEqual({});
  });
});

describe('createAcpToolNormalization.normalizeToolUseResult', () => {
  it('returns undefined when no fields are produced', () => {
    const { normalizeToolUseResult } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      normalizeToolUseResult('glob', {}, { metadata: {} }),
    ).toBeUndefined();
  });

  it('extracts file paths from write and edit results', () => {
    const { normalizeToolUseResult } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(
      normalizeToolUseResult('write', { file_path: '/a.md' }, { metadata: {} }),
    ).toEqual({ filePath: '/a.md' });

    expect(
      normalizeToolUseResult('edit', { filePath: '/b.md' }, {}),
    ).toEqual({ filePath: '/b.md' });

    expect(
      normalizeToolUseResult('write', { file_path: '/c.md' }, {
        metadata: { filepath: '/c.md' },
      }),
    ).toEqual({ filePath: '/c.md' });
  });

  it('attaches structured answers for the question tool result', () => {
    const { normalizeToolUseResult } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    const result = normalizeToolUseResult(
      'question',
      {
        questions: [
          {
            header: 'Deploy',
            id: 'deploy',
            options: [
              { description: 'Ship the change', label: 'Yes' },
              { description: 'Hold the deploy', label: 'No' },
            ],
            question: 'Deploy now?',
          },
        ],
      },
      { metadata: { answers: [['Yes']] }, output: 'ok' },
    );

    expect(result).toEqual({
      answers: { deploy: 'Yes', 'Deploy now?': 'Yes' },
    });
  });

  it('honors extra file_path aliases (kimi: input.path) for write/edit results', () => {
    const { normalizeToolUseResult } = createAcpToolNormalization({
      toolNameByRawKey: KIMI_MAP,
      extraFilePathInputKeys: ['path'],
    });

    expect(
      normalizeToolUseResult('WriteFile', { path: '/a.md' }, { metadata: {} }),
    ).toEqual({ filePath: '/a.md' });

    expect(
      normalizeToolUseResult('EditFile', { path: '/b.md' }, { metadata: {} }),
    ).toEqual({ filePath: '/b.md' });
  });
});

describe('createAcpToolNormalization.createStreamAdapter', () => {
  it('returns a fresh AcpToolStreamAdapter on each call', () => {
    const { createStreamAdapter } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    expect(createStreamAdapter()).toBeInstanceOf(AcpToolStreamAdapter);
    expect(createStreamAdapter()).not.toBe(createStreamAdapter());
  });

  it('threads normalizeToolName through tool call updates', () => {
    const { createStreamAdapter } = createAcpToolNormalization({
      toolNameByRawKey: OPENCODE_MAP,
    });

    const adapter = createStreamAdapter();

    const out = adapter.normalizeToolCall(
      { rawInput: { file_path: '/x.md' }, title: 'read', toolCallId: 't1' },
      [{ id: 't1', input: {}, name: 'read', type: 'tool_use' }],
    );

    expect(out).toEqual([
      { id: 't1', input: { file_path: '/x.md' }, name: 'Read', type: 'tool_use' },
    ]);
  });
});
