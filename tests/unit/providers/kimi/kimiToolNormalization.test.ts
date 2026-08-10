import { TOOL_BASH, TOOL_EDIT, TOOL_READ } from '@/core/tools/toolNames';
import {
  normalizeKimiToolInput,
  normalizeKimiToolName,
  normalizeKimiToolUseResult,
  resolveKimiRawToolName,
} from '@/providers/kimi/normalization/kimiToolNormalization';

describe('normalizeKimiToolName', () => {
  it('maps capitalized Kimi tool names to core tool ids', () => {
    expect(normalizeKimiToolName('Shell')).toBe(TOOL_BASH);
    expect(normalizeKimiToolName('shell')).toBe(TOOL_BASH);
    expect(normalizeKimiToolName('ReadFile')).toBe(TOOL_READ);
    expect(normalizeKimiToolName('EditFile')).toBe(TOOL_EDIT);
    expect(normalizeKimiToolName('Glob')).toBe('Glob');
  });

  it('passes unknown tool names through raw', () => {
    expect(normalizeKimiToolName('custom_tool')).toBe('custom_tool');
    expect(normalizeKimiToolName(undefined)).toBe('tool');
  });
});

describe('resolveKimiRawToolName', () => {
  it('resolves from the first token of the update title', () => {
    expect(resolveKimiRawToolName(undefined, { title: 'Shell: ls -la' })).toBe('shell');
    expect(resolveKimiRawToolName(undefined, { title: 'Glob' })).toBe('glob');
  });

  it('prefers a known title token over the current raw name', () => {
    expect(resolveKimiRawToolName('readfile', { title: 'Shell: ls -la' })).toBe('shell');
  });

  it('keeps the current raw name when the title token is unknown', () => {
    expect(resolveKimiRawToolName('readfile', { title: 'Custom action' })).toBe('readfile');
  });

  it('falls back to kind-based mapping', () => {
    expect(resolveKimiRawToolName(undefined, { kind: 'execute' })).toBe('bash');
    expect(resolveKimiRawToolName(undefined, { kind: 'read' })).toBe('read');
  });
});

describe('normalizeKimiToolInput', () => {
  it('normalizes read inputs across key variants', () => {
    expect(normalizeKimiToolInput('ReadFile', { filePath: 'a.md', limit: 10 })).toEqual({
      file_path: 'a.md',
      limit: 10,
    });
    expect(normalizeKimiToolInput('read', { path: 'b.md' })).toEqual({
      file_path: 'b.md',
    });
  });

  it('normalizes edit inputs', () => {
    expect(normalizeKimiToolInput('EditFile', {
      file_path: 'a.md',
      oldString: 'old',
      newString: 'new',
    })).toEqual({
      file_path: 'a.md',
      old_string: 'old',
      new_string: 'new',
    });
  });
});

describe('normalizeKimiToolUseResult', () => {
  it('extracts file paths from write/edit results', () => {
    const result = normalizeKimiToolUseResult('WriteFile', { file_path: 'a.md' }, {});
    expect(result?.filePath).toBe('a.md');
  });

  it('returns undefined for unknown metadata', () => {
    expect(normalizeKimiToolUseResult('Glob', {}, {})).toBeUndefined();
  });
});
