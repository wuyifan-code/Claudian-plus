import { buildDiagnosticsReport, redact } from '@/shared/feedback/diagnostics';
import type { FeedbackEntry } from '@/shared/feedback/types';

function entry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    id: 'fb-1',
    level: 'error',
    kind: 'retryable',
    key: 'stream.failed',
    title: 'Stream failed',
    scope: 'chat',
    count: 1,
    at: new Date('2026-11-06T10:00:00Z').getTime(),
    ...overrides,
  };
}

describe('feedback diagnostics redaction', () => {
  it('removes Windows absolute paths', () => {
    const text = redact('failed to read D:\\Vaults\\Creative Vault\\notes\\a.md');
    expect(text).toContain('<path>');
    expect(text).not.toContain('Vaults');
  });

  it('removes POSIX absolute paths', () => {
    const text = redact('ENOENT /home/alice/vault/notes/b.md');
    expect(text).toContain('<path>');
    expect(text).not.toContain('alice');
  });

  it('removes API tokens and bearer headers', () => {
    const text = redact('token sk-abcdefgh12345678 and Authorization: Bearer abc.def-ghi');
    expect(text).not.toContain('sk-abcdefgh12345678');
    expect(text).not.toContain('abc.def-ghi');
    expect(text).toContain('<redacted>');
  });

  it('removes named secrets', () => {
    const text = redact('api_key=super-secret-value retry');
    expect(text).not.toContain('super-secret-value');
    expect(text).toContain('<redacted>');
  });

  it('strips terminal escape sequences', () => {
    expect(redact('\u001b[31mboom\u001b[0m')).toBe('boom');
  });
});

describe('buildDiagnosticsReport', () => {
  it('includes the environment and the newest entries', () => {
    const report = buildDiagnosticsReport({
      entries: [entry({
        detail: 'socket closed',
        actions: [{ id: 'retry', label: 'Retry', run: () => undefined }],
      })],
      env: { version: '3.2.7', locale: 'zh-CN', theme: 'dark' },
      generatedAt: new Date('2026-11-06T10:00:00Z').getTime(),
    });

    expect(report).toContain('version: 3.2.7');
    expect(report).toContain('locale: zh-CN');
    expect(report).toContain('stream.failed');
    expect(report).toContain('socket closed');
    expect(report).toContain('actions: retry');
  });

  it('redacts secrets and paths inside entry detail', () => {
    const report = buildDiagnosticsReport({
      entries: [
        entry({
          detail: 'failed at C:\\Users\\alice\\vault\\a.md with sk-live-1234567890',
        }),
      ],
      env: {},
    });

    expect(report).not.toContain('alice');
    expect(report).not.toContain('sk-live-1234567890');
    expect(report).toContain('<path>');
  });

  it('truncates long details instead of copying them whole', () => {
    const report = buildDiagnosticsReport({
      entries: [entry({ detail: 'x'.repeat(500) })],
      env: {},
    });

    expect(report).not.toContain('x'.repeat(500));
    expect(report).toContain('\u2026');
  });

  it('caps how many entries it reports', () => {
    const entries = Array.from({ length: 60 }, (_unused, index) =>
      entry({ id: `fb-${index}`, key: `key.${index}`, title: `Entry ${index}` }));

    const report = buildDiagnosticsReport({ entries, env: {} });

    expect(report).toContain('recent feedback (60)');
    expect(report).toContain('key.49');
    expect(report).not.toContain('key.50');
  });

  it('says so when there is nothing to report', () => {
    const report = buildDiagnosticsReport({ entries: [], env: {} });
    expect(report).toContain('- (none)');
  });
});
