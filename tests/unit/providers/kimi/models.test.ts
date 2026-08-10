import {
  buildKimiBaseModels,
  decodeKimiModelId,
  encodeKimiModelId,
  groupKimiDiscoveredModels,
  isKimiModelSelectionId,
  isKimiThinkingVariant,
  KIMI_SYNTHETIC_MODEL_ID,
  normalizeKimiDiscoveredModels,
  resolveKimiBaseModelRawId,
} from '@/providers/kimi/models';

describe('Kimi model id encoding', () => {
  it('encodes and decodes raw model ids with the kimi: prefix', () => {
    expect(encodeKimiModelId('kimi-code/kimi-for-coding')).toBe('kimi:kimi-code/kimi-for-coding');
    expect(decodeKimiModelId('kimi:kimi-code/kimi-for-coding')).toBe('kimi-code/kimi-for-coding');
  });

  it('falls back to the synthetic id for empty raw ids', () => {
    expect(encodeKimiModelId('  ')).toBe(KIMI_SYNTHETIC_MODEL_ID);
  });

  it('rejects foreign selection ids', () => {
    expect(decodeKimiModelId('opencode:build')).toBeNull();
  });

  it('recognizes kimi selection ids', () => {
    expect(isKimiModelSelectionId('kimi:k3')).toBe(true);
    expect(isKimiModelSelectionId(KIMI_SYNTHETIC_MODEL_ID)).toBe(true);
    expect(isKimiModelSelectionId('claude-code/opus')).toBe(false);
  });
});

describe('Kimi thinking variants', () => {
  it('detects the ,thinking suffix', () => {
    expect(isKimiThinkingVariant('kimi-code/k3,thinking')).toBe(true);
    expect(isKimiThinkingVariant('kimi-code/k3')).toBe(false);
  });

  it('resolves base ids from thinking variants regardless of the discovered list', () => {
    const discovered = [
      { label: 'k3', rawId: 'kimi-code/k3' },
      { label: 'k3 (thinking)', rawId: 'kimi-code/k3,thinking' },
    ];
    expect(resolveKimiBaseModelRawId('kimi-code/k3,thinking', discovered)).toBe('kimi-code/k3');
    expect(resolveKimiBaseModelRawId('kimi-code/k3', discovered)).toBe('kimi-code/k3');
  });

  it('keeps unknown ids untouched', () => {
    expect(resolveKimiBaseModelRawId('custom/model', [])).toBe('custom/model');
  });
});

describe('normalizeKimiDiscoveredModels', () => {
  it('dedupes and trims entries', () => {
    const models = normalizeKimiDiscoveredModels([
      { rawId: '  kimi-code/k3  ', name: 'k3', label: 'k3' },
      { rawId: 'kimi-code/k3', label: 'k3' },
      { rawId: 'kimi-code/k3,thinking', label: 'k3 (thinking)' },
    ]);
    expect(models.map(model => model.rawId)).toEqual([
      'kimi-code/k3',
      'kimi-code/k3,thinking',
    ]);
  });
});

describe('buildKimiBaseModels', () => {
  it('groups thinking variants under the base model and marks thinking support', () => {
    const baseModels = buildKimiBaseModels([
      { label: 'k3', rawId: 'kimi-code/k3' },
      { label: 'k3 (thinking)', rawId: 'kimi-code/k3,thinking' },
      { label: 'k2.7', rawId: 'kimi-code/kimi-for-coding' },
    ]);
    const k3 = baseModels.find(model => model.rawId === 'kimi-code/k3');
    expect(k3?.supportsThinking).toBe(true);
    expect(k3?.label).toBe('k3');
  });
});

describe('groupKimiDiscoveredModels', () => {
  it('groups by provider label derived from the model id prefix', () => {
    const groups = groupKimiDiscoveredModels([
      { label: 'k3', rawId: 'kimi-code/k3' },
      { label: 'deepseek-v4', rawId: 'opencode-go/deepseek-v4' },
    ]);
    expect(groups.map(group => group.providerLabel)).toEqual(['kimi-code', 'opencode-go']);
  });
});
