import {
  ANTIGRAVITY_MODEL_DISCOVERY_SUPPORT,
  ANTIGRAVITY_MODEL_PREFIX,
  ANTIGRAVITY_REASONING_EFFORT_SUPPORT,
  decodeAntigravityModelSelectionId,
  DEFAULT_ANTIGRAVITY_MODEL_ID,
  DEFAULT_ANTIGRAVITY_MODELS,
  encodeAntigravityModelSelectionId,
  isAntigravityModelSelectionId,
  looksLikeAntigravityModel,
  normalizeAntigravityManualModelId,
  toAntigravityRuntimeModelId,
} from '@/providers/antigravity/models';

describe('antigravity model selection encoding', () => {
  it('namespaces bare model ids so they cannot collide with other providers', () => {
    expect(encodeAntigravityModelSelectionId('gemini-3.8-flash-low'))
      .toBe('antigravity/gemini-3.8-flash-low');
    // The namespaced id must not equal a bare id another provider could own.
    expect(encodeAntigravityModelSelectionId('gemini-3.8-flash-low'))
      .not.toBe('gemini-3.8-flash-low');
  });

  it('is idempotent for already-namespaced ids', () => {
    const namespaced = 'antigravity/gemini-3.8-flash-low';
    expect(encodeAntigravityModelSelectionId(namespaced)).toBe(namespaced);
  });

  it('trims surrounding whitespace before prefixing', () => {
    expect(encodeAntigravityModelSelectionId('  gemini-3.1-pro-high  '))
      .toBe('antigravity/gemini-3.1-pro-high');
  });

  it('returns an empty string for empty input', () => {
    expect(encodeAntigravityModelSelectionId('')).toBe('');
    expect(encodeAntigravityModelSelectionId('   ')).toBe('');
  });

  it('never claims ids namespaced for another provider', () => {
    expect(decodeAntigravityModelSelectionId('opencode/gemini-3.8-flash-low')).toBeNull();
    expect(decodeAntigravityModelSelectionId('claude-code/gemini-3.8-flash-low')).toBeNull();
    expect(isAntigravityModelSelectionId('opencode/gemini-3.8-flash-low')).toBe(false);
  });

  it('decodes its own namespaced ids and rejects bare ids', () => {
    expect(decodeAntigravityModelSelectionId('antigravity/gemini-3.8-flash-low'))
      .toBe('gemini-3.8-flash-low');
    expect(decodeAntigravityModelSelectionId('gemini-3.8-flash-low')).toBeNull();
    expect(decodeAntigravityModelSelectionId('')).toBeNull();
    expect(decodeAntigravityModelSelectionId('antigravity/')).toBeNull();
  });

  it('round-trips a manual model id through encode and toRuntimeModelId', () => {
    const encoded = encodeAntigravityModelSelectionId('gemini-3.1-pro-low');
    expect(isAntigravityModelSelectionId(encoded)).toBe(true);
    expect(toAntigravityRuntimeModelId(encoded)).toBe('gemini-3.1-pro-low');
    // Bare runtime ids pass through unchanged, as the core encoding does.
    expect(toAntigravityRuntimeModelId('gemini-3.1-pro-low')).toBe('gemini-3.1-pro-low');
    // Another provider's namespace is never stripped.
    expect(toAntigravityRuntimeModelId('opencode/gemini-3.1-pro-low'))
      .toBe('opencode/gemini-3.1-pro-low');
  });

  it('maps display labels to valid CLI model slugs', () => {
    expect(toAntigravityRuntimeModelId('Gemini 3.8 Flash (High)')).toBe('gemini-3.8-flash-high');
    expect(toAntigravityRuntimeModelId('Gemini 3.1 Pro (Low)')).toBe('gemini-3.1-pro-low');
  });

  it('keeps the provider namespace constant aligned with the encoding', () => {
    expect(ANTIGRAVITY_MODEL_PREFIX).toBe('antigravity/');
    expect(encodeAntigravityModelSelectionId('x').startsWith(ANTIGRAVITY_MODEL_PREFIX)).toBe(true);
  });
});

describe('DEFAULT_ANTIGRAVITY_MODELS', () => {
  it('includes default Gemini models verified against AGY CLI', () => {
    expect(DEFAULT_ANTIGRAVITY_MODELS.length).toBeGreaterThan(0);
    expect(DEFAULT_ANTIGRAVITY_MODELS.some(m => m.rawId === DEFAULT_ANTIGRAVITY_MODEL_ID)).toBe(true);
    expect(DEFAULT_ANTIGRAVITY_MODEL_ID).toBe('gemini-3.8-flash-high');
  });
});

describe('looksLikeAntigravityModel', () => {
  it('identifies gemini and antigravity namespaced models', () => {
    expect(looksLikeAntigravityModel('gemini-3.8-flash-high')).toBe(true);
    expect(looksLikeAntigravityModel('antigravity/gemini-3.8-flash-low')).toBe(true);
    expect(looksLikeAntigravityModel('Gemini 3.8 Flash (High)')).toBe(true);
    expect(looksLikeAntigravityModel('claude-3-5-sonnet')).toBe(false);
    expect(looksLikeAntigravityModel('gpt-4o')).toBe(false);
    expect(looksLikeAntigravityModel('')).toBe(false);
  });
});

describe('normalizeAntigravityManualModelId', () => {
  it('trims string input and rejects everything else', () => {
    expect(normalizeAntigravityManualModelId('  gemini-3.8-flash-medium  '))
      .toBe('gemini-3.8-flash-medium');
    expect(normalizeAntigravityManualModelId(42)).toBe('');
    expect(normalizeAntigravityManualModelId(null)).toBe('');
    expect(normalizeAntigravityManualModelId(undefined)).toBe('');
  });
});

describe('capability declarations', () => {
  it('declares reasoning effort unsupported until verified against a real model', () => {
    expect(ANTIGRAVITY_REASONING_EFFORT_SUPPORT.supported).toBe(false);
    expect(ANTIGRAVITY_REASONING_EFFORT_SUPPORT.reason).toMatch(/effort/i);
  });

  it('declares model discovery unavailable so manual ids stay the answer', () => {
    expect(ANTIGRAVITY_MODEL_DISCOVERY_SUPPORT.available).toBe(false);
    expect(ANTIGRAVITY_MODEL_DISCOVERY_SUPPORT.reason).toMatch(/manual/i);
  });
});
