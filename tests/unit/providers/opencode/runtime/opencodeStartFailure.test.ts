import { explainOpencodeStartFailure } from '@/providers/opencode/runtime/OpencodeChatRuntime';

describe('explainOpencodeStartFailure', () => {
  it('names the database lock when OpenCode reports an unavailable server', () => {
    const explained = explainOpencodeStartFailure(
      new Error('Internal error: OpenCode server is unavailable'),
    );

    expect(explained).toContain('OpenCode server is unavailable');
    expect(explained).toContain('holding the same database');
  });

  it('names the database lock for the raw service failure too', () => {
    expect(explainOpencodeStartFailure(new Error('Internal error: Internal service failure')))
      .toContain('holding the same database');
  });

  it('leaves unrelated failures alone', () => {
    expect(explainOpencodeStartFailure(new Error('Model not found'))).toBe('Model not found');
  });

  it('falls back to a readable message for non-errors', () => {
    expect(explainOpencodeStartFailure('boom')).toBe('OpenCode session creation failed');
  });
});
