import {
  buildDshPickerModels,
  decodeDshModelId,
  DSH_DEFAULT_MODELS,
  encodeDshModelId,
  isDshModelSelectionId,
  normalizeDshModelAliases,
  normalizeDshVisibleModels,
} from '@/providers/dsh/models';

describe('dsh model ids', () => {
  it('encodes and decodes raw model ids with the dsh: prefix', () => {
    expect(encodeDshModelId('deepseek-v4-flash')).toBe('dsh:deepseek-v4-flash');
    expect(decodeDshModelId('dsh:deepseek-v4-pro')).toBe('deepseek-v4-pro');
  });

  it('returns the synthetic id for empty raw ids', () => {
    expect(encodeDshModelId('  ')).toBe('dsh');
  });

  it('recognizes only prefixed and synthetic selection ids', () => {
    expect(isDshModelSelectionId('dsh')).toBe(true);
    expect(isDshModelSelectionId('dsh:deepseek-v4-flash')).toBe(true);
    expect(isDshModelSelectionId('deepseek-v4-flash')).toBe(false);
    expect(isDshModelSelectionId('claude')).toBe(false);
  });

  it('rejects decoding unprefixed model strings', () => {
    expect(decodeDshModelId('deepseek-v4-flash')).toBeNull();
  });
});

describe('dsh model normalization', () => {
  it('normalizes visible models to trimmed unique strings', () => {
    expect(normalizeDshVisibleModels([' deepseek-v4-flash ', 'deepseek-v4-pro', 'deepseek-v4-flash']))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  it('drops non-string and empty entries', () => {
    expect(normalizeDshVisibleModels(['x', 1, null, '', 'y'])).toEqual(['x', 'y']);
  });

  it('normalizes aliases by trimming both sides', () => {
    expect(normalizeDshModelAliases({ 'deepseek-v4-flash': '  Flash  ' }))
      .toEqual({ 'deepseek-v4-flash': 'Flash' });
  });
});

describe('buildDshPickerModels', () => {
  it('marks catalog models available and unknown models unavailable', () => {
    const models = buildDshPickerModels([], ['deepseek-v4-flash', 'custom-model']);
    const flash = models.find((model) => model.id === 'deepseek-v4-flash');
    const custom = models.find((model) => model.id === 'custom-model');
    expect(flash).toBeDefined();
    expect(flash?.isAvailable).toBe(true);
    expect(custom).toBeDefined();
    expect(custom?.isAvailable).toBe(false);
  });

  it('starts from the static catalog when nothing is discovered', () => {
    const models = buildDshPickerModels([], []);
    expect(models.map((model) => model.id)).toEqual(DSH_DEFAULT_MODELS.map((model) => model.rawId));
  });

  it('prefers discovered models over the static catalog', () => {
    const models = buildDshPickerModels(
      [{ rawId: 'deepseek-v4-flash', label: 'Flash', contextWindow: 1000000 }],
      [],
    );
    expect(models).toEqual([
      { description: '1,000,000 tokens context', id: 'deepseek-v4-flash', isAvailable: true, name: 'Flash' },
    ]);
  });
});
