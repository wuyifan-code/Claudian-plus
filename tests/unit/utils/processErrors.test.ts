import { formatProcessStartError } from '@/utils/processErrors';

describe('formatProcessStartError', () => {
  it('explains how to recover from a missing executable', () => {
    const error = Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' });

    expect(formatProcessStartError(error, 'OpenCode', 'opencode').message).toContain(
      'Install OpenCode or set its full CLI path',
    );
  });

  it('explains permission failures', () => {
    const error = Object.assign(new Error('spawn pi EACCES'), { code: 'EACCES' });

    expect(formatProcessStartError(error, 'Pi', 'pi').message).toContain(
      'Check its permissions or choose a different CLI path',
    );
  });

  it('preserves an unexpected startup error', () => {
    const error = new Error('invalid working directory');

    expect(formatProcessStartError(error, 'Codex', 'codex').message).toBe(
      'Codex failed to start: invalid working directory',
    );
  });
});
