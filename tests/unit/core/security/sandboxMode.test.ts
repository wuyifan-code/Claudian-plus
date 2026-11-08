import {
  effectivePermissionMode,
  resolveSandboxMode,
  sandboxBypassesApprovals,
} from '@/core/security/sandboxMode';

describe('sandbox axis', () => {
  it('prefers an explicit sandbox mode over the legacy YOLO switch', () => {
    expect(resolveSandboxMode({ sandboxMode: 'read', permissionMode: 'yolo' })).toBe('read');
    expect(resolveSandboxMode({ sandboxMode: 'workspace', permissionMode: 'yolo' })).toBe('workspace');
    expect(resolveSandboxMode({ sandboxMode: 'full', permissionMode: 'normal' })).toBe('full');
  });

  it('folds a legacy YOLO switch into full and everything else into workspace', () => {
    expect(resolveSandboxMode({ permissionMode: 'yolo' })).toBe('full');
    expect(resolveSandboxMode({ permissionMode: 'normal' })).toBe('workspace');
    expect(resolveSandboxMode({ permissionMode: 'plan' })).toBe('workspace');
    expect(resolveSandboxMode({})).toBe('workspace');
  });

  it('ignores unknown stored values', () => {
    expect(resolveSandboxMode({ sandboxMode: 'danger', permissionMode: 'yolo' })).toBe('full');
    expect(resolveSandboxMode({ sandboxMode: 42, permissionMode: 'normal' })).toBe('workspace');
  });

  it('treats only full as approval-bypassing', () => {
    expect(sandboxBypassesApprovals('full')).toBe(true);
    expect(sandboxBypassesApprovals('workspace')).toBe(false);
    expect(sandboxBypassesApprovals('read')).toBe(false);
  });
});

describe('effectivePermissionMode', () => {
  it('reports full as yolo so the provider paths stay unchanged', () => {
    expect(effectivePermissionMode({ sandboxMode: 'full' })).toBe('yolo');
    expect(effectivePermissionMode({ permissionMode: 'yolo' })).toBe('yolo');
  });

  it('keeps approvals on for read and workspace', () => {
    expect(effectivePermissionMode({ sandboxMode: 'read' })).toBe('normal');
    expect(effectivePermissionMode({ sandboxMode: 'workspace' })).toBe('normal');
    expect(effectivePermissionMode({ permissionMode: 'normal' })).toBe('normal');
  });

  it('lets plan win over full, because plan is an approval mode', () => {
    expect(effectivePermissionMode({ sandboxMode: 'full', permissionMode: 'plan' })).toBe('plan');
    expect(effectivePermissionMode({ permissionMode: 'plan' }, 'plan')).toBe('plan');
  });

  it('honours an explicit override from the active tab', () => {
    expect(effectivePermissionMode({ sandboxMode: 'workspace' }, 'yolo')).toBe('normal');
    expect(effectivePermissionMode({ sandboxMode: 'full' }, 'normal')).toBe('yolo');
    expect(effectivePermissionMode({ sandboxMode: 'full' }, 'plan')).toBe('plan');
  });
});
