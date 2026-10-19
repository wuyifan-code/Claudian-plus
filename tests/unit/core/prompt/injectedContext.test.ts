import {
  hasInjectedPromptContext,
  stripInjectedPromptContext,
} from '@/core/prompt/injectedContext';

const BLOCK = [
  '<system_context>',
  '## Long-term Memory',
  '',
  'User prefers Chinese.',
  '',
  '## Awareness Context',
  '',
  '### 协作风格',
  'Concise.',
  '</system_context>',
].join('\n');

describe('injected prompt context stripping', () => {
  it('removes a leading block and keeps the user prompt', () => {
    expect(stripInjectedPromptContext(`${BLOCK}\n\n对抗性审查是什么？`))
      .toBe('对抗性审查是什么？');
  });

  it('removes a block that is not at the very start', () => {
    expect(stripInjectedPromptContext(`note\n\n${BLOCK}\n\nquestion`))
      .toBe('note\n\nquestion');
  });

  it('handles CRLF from a Windows-written session file', () => {
    expect(stripInjectedPromptContext(`${BLOCK.replace(/\n/g, '\r\n')}\r\n\r\nhello`))
      .toBe('hello');
  });

  it('matches the tag case-insensitively', () => {
    expect(stripInjectedPromptContext(
      '<SYSTEM_CONTEXT>\nx\n</SYSTEM_CONTEXT>\n\nhello',
    )).toBe('hello');
  });

  it('leaves text without a block untouched', () => {
    expect(stripInjectedPromptContext('plain question')).toBe('plain question');
    expect(stripInjectedPromptContext('<system_context>unterminated')).toBe('<system_context>unterminated');
  });

  it('returns an empty string when the turn carried only injected context', () => {
    expect(stripInjectedPromptContext(BLOCK)).toBe('');
  });

  it('detects injected context without rewriting the text', () => {
    expect(hasInjectedPromptContext(BLOCK)).toBe(true);
    expect(hasInjectedPromptContext('plain')).toBe(false);
  });
});
