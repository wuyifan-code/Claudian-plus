import { resolveAntigravitySkipPermissions } from '@/providers/antigravity/runtime/antigravityPermissionPolicy';

describe('resolveAntigravitySkipPermissions', () => {
  it('never lets read-only hand the CLI a blanket skip', () => {
    expect(resolveAntigravitySkipPermissions(true, 'read')).toBe(false);
    expect(resolveAntigravitySkipPermissions(false, 'read')).toBe(false);
  });

  it('keeps the provider auto-approve preference inside the workspace tier', () => {
    expect(resolveAntigravitySkipPermissions(true, 'workspace')).toBe(true);
    expect(resolveAntigravitySkipPermissions(false, 'workspace')).toBe(false);
  });

  it('always skips for full access', () => {
    expect(resolveAntigravitySkipPermissions(true, 'full')).toBe(true);
    expect(resolveAntigravitySkipPermissions(false, 'full')).toBe(true);
  });
});
