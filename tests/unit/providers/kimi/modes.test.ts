import {
  KIMI_DEFAULT_MODE_ID,
  normalizeKimiAvailableModes,
} from '@/providers/kimi/modes';

describe('Kimi modes', () => {
  it('normalizes ACP mode entries', () => {
    const modes = normalizeKimiAvailableModes([
      { description: 'The default mode.', id: 'default', name: 'Default' },
      { id: 'default', name: 'Default' },
      { id: 'custom', name: 'Custom' },
    ]);
    expect(modes.map(mode => mode.id)).toEqual(['default', 'custom']);
  });

  it('returns an empty list for non-array input', () => {
    expect(normalizeKimiAvailableModes(null)).toEqual([]);
    expect(normalizeKimiAvailableModes('nope')).toEqual([]);
  });

  it('exposes the default mode id constant', () => {
    expect(KIMI_DEFAULT_MODE_ID).toBe('default');
  });
});
