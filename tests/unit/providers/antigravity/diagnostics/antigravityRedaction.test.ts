import {
  ANTIGRAVITY_REDACTED_CONTENT,
  ANTIGRAVITY_REDACTED_EMAIL,
  ANTIGRAVITY_REDACTED_PATH,
  ANTIGRAVITY_REDACTED_SECRET,
  basenameAntigravityPath,
  redactAntigravityText,
} from '@/providers/antigravity/diagnostics/antigravityRedaction';

const PRIVATE_WINDOWS_PATH = 'C:\\Users\\ada\\AppData\\Local\\agy\\bin\\agy.EXE';
const PRIVATE_POSIX_PATH = '/home/ada/.local/bin/agy';
const EMAIL = 'ada@example.com';
const PROMPT_BODY = [
  'You are a helpful assistant working inside a vault.',
  'Always answer in the language the user wrote in.',
  'Current task: summarize the attached note without quoting it.',
].join('\n');

describe('redactAntigravityText', () => {
  it('strips an absolute Windows path', () => {
    expect(redactAntigravityText(`ENOENT ${PRIVATE_WINDOWS_PATH}`))
      .toBe(`ENOENT ${ANTIGRAVITY_REDACTED_PATH}`);
  });

  it('strips an absolute POSIX path', () => {
    expect(redactAntigravityText(`agy not found at ${PRIVATE_POSIX_PATH}`))
      .toBe(`agy not found at ${ANTIGRAVITY_REDACTED_PATH}`);
  });

  it('strips paths whose account name contains a space', () => {
    const windows = redactAntigravityText('spawn C:\\Users\\John Smith\\agy.EXE ENOENT');
    expect(windows).toContain('spawn');
    expect(windows).not.toContain('John');
    expect(windows).not.toContain('Smith');

    const posix = redactAntigravityText('cannot read /Users/John Smith/Library/agy');
    expect(posix).not.toContain('John');
    expect(posix).not.toContain('Smith');

    const envHome = redactAntigravityText('state in %USERPROFILE%\\My Folder\\agy');
    expect(envHome).not.toContain('My Folder');
  });

  it('strips a home-relative and environment-variable path', () => {
    for (const text of [
      'state lives in ~/.gemini/antigravity-cli/settings.json',
      'state lives in $HOME/.gemini/antigravity-cli/settings.json',
      'state lives in %USERPROFILE%\\AppData\\Local\\agy',
    ]) {
      const redacted = redactAntigravityText(text);
      expect(redacted).not.toContain('.gemini');
      expect(redacted).not.toContain('AppData');
      expect(redacted).not.toContain('USERPROFILE');
      expect(redacted).not.toContain('ada');
    }
  });

  it('strips an email address', () => {
    expect(redactAntigravityText(`account ${EMAIL}`)).toBe(`account ${ANTIGRAVITY_REDACTED_EMAIL}`);
  });

  it('strips token-shaped strings', () => {
    const secrets = [
      'sk-live-0123456789abcdefghij',
      'ghp_0123456789abcdefghij0123456789abcd',
      'AIzaSyA0123456789abcdefghij0123456789',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      ['xoxb', 'mock', 'token', 'abcdefghijklmnop'].join('-'),
      'ya29.0123456789abcdefghij',
    ];

    for (const secret of secrets) {
      const redacted = redactAntigravityText(`auth ${secret}`);
      expect(redacted).not.toContain(secret);
      expect(redacted).toContain(ANTIGRAVITY_REDACTED_SECRET);
    }

    const bearer = redactAntigravityText('Authorization: Bearer abc123def456ghi789jkl');
    expect(bearer).not.toContain('abc123def456ghi789jkl');
    const assigned = redactAntigravityText('api_key=abc1234567890defghij');
    expect(assigned).not.toContain('abc1234567890defghij');
  });

  it('replaces a prompt-like body with a content marker', () => {
    expect(redactAntigravityText(PROMPT_BODY)).toBe(ANTIGRAVITY_REDACTED_CONTENT);
    expect(redactAntigravityText('x'.repeat(400))).toBe(ANTIGRAVITY_REDACTED_CONTENT);
    expect(redactAntigravityText(`first line\nsecond line`)).toBe(ANTIGRAVITY_REDACTED_CONTENT);
  });

  it('keeps short machine-readable text untouched', () => {
    expect(redactAntigravityText('exit code 1')).toBe('exit code 1');
    expect(redactAntigravityText('incomplete-result')).toBe('incomplete-result');
    expect(redactAntigravityText('')).toBe('');
  });

  it('is idempotent, so a redacted value can be redacted again safely', () => {
    const once = redactAntigravityText(`ENOENT ${PRIVATE_WINDOWS_PATH} ${EMAIL} sk-live-0123456789abcdefghij`);
    expect(redactAntigravityText(once)).toBe(once);
  });
});

describe('basenameAntigravityPath', () => {
  it('keeps only the executable name', () => {
    expect(basenameAntigravityPath(PRIVATE_WINDOWS_PATH)).toBe('agy.EXE');
    expect(basenameAntigravityPath(PRIVATE_POSIX_PATH)).toBe('agy');
    expect(basenameAntigravityPath('agy')).toBe('agy');
    expect(basenameAntigravityPath('  agy.EXE  ')).toBe('agy.EXE');
  });

  it('returns an empty string for a blank path', () => {
    expect(basenameAntigravityPath('   ')).toBe('');
    expect(basenameAntigravityPath('')).toBe('');
  });
});
