import { resolvePiToolMode } from '@/providers/pi/runtime/piToolModePolicy';

describe('resolvePiToolMode', () => {
  it('narrows every tool mode to readonly in the read-only tier', () => {
    expect(resolvePiToolMode('all', 'read')).toBe('readonly');
    expect(resolvePiToolMode('readonly', 'read')).toBe('readonly');
  });

  it('keeps the user configuration for workspace and full', () => {
    expect(resolvePiToolMode('all', 'workspace')).toBe('all');
    expect(resolvePiToolMode('readonly', 'workspace')).toBe('readonly');
    expect(resolvePiToolMode('all', 'full')).toBe('all');
  });
});
