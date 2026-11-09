import {
  normalizeOpencodeModelVariants,
  resolveOpencodeDefaultThinkingLevel,
} from '@/providers/opencode/models';

describe('OpenCode reasoning ladder', () => {
  it('drops the provider "default" rung from the ladder', () => {
    const variants = normalizeOpencodeModelVariants([
      { label: 'Low', value: 'low' },
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
      { label: 'Default', value: 'default' },
    ]);

    expect(variants.map((variant) => variant.value)).toEqual(['low', 'high', 'max']);
  });

  it('ignores a Default entry regardless of casing', () => {
    expect(normalizeOpencodeModelVariants([{ value: 'Default' }])).toEqual([]);
  });

  it('lands on a real rung when the session reports default', () => {
    const options = normalizeOpencodeModelVariants([
      { label: 'Low', value: 'low' },
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
      { label: 'Default', value: 'default' },
    ]);

    expect(resolveOpencodeDefaultThinkingLevel(options, undefined, 'default')).toBe('high');
  });

  it('keeps an explicit preference', () => {
    const options = normalizeOpencodeModelVariants([
      { label: 'Low', value: 'low' },
      { label: 'Max', value: 'max' },
    ]);

    expect(resolveOpencodeDefaultThinkingLevel(options, 'max', 'default')).toBe('max');
  });

  it('falls back to the strongest rung when there is no middle ground', () => {
    const options = normalizeOpencodeModelVariants([
      { label: 'Minimal', value: 'minimal' },
      { label: 'Low', value: 'low' },
    ]);

    // minimal ranks below low, so the ladder's last rung is the strongest one here.
    expect(resolveOpencodeDefaultThinkingLevel(options, undefined, 'default')).toBe('low');
  });
});
