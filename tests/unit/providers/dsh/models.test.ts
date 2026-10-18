import { decodeDshModelId, encodeDshModelId } from '@/providers/dsh/models';
import { dshChatUIConfig } from '@/providers/dsh/ui/DshChatUIConfig';

describe('DeepSeek Harness model projection', () => {
  it('round-trips namespaced identifiers with reserved characters', () => {
    const id = encodeDshModelId('native/local', 'model:with/slash');
    expect(id).toBe('dsh/native%2Flocal/model%3Awith%2Fslash');
    expect(decodeDshModelId(id)).toEqual({ provider: 'native/local', model: 'model:with/slash' });
    expect(decodeDshModelId('dsh/%XX/model')).toBeNull();
    expect(decodeDshModelId('dsh//model')).toBeNull();
    expect(decodeDshModelId('pi/native/model')).toBeNull();
  });

  it('shows native default without claiming a concrete model or reasoning capability', () => {
    expect(dshChatUIConfig.getModelOptions({})).toEqual([
      { value: 'dsh/default', label: 'DeepSeek Harness native default' },
    ]);
    expect(dshChatUIConfig.getReasoningOptions('dsh/default', {})).toEqual([]);
    expect(dshChatUIConfig.isAdaptiveReasoningModel('dsh/default', {})).toBe(false);
  });

  it('exposes the shared Safe/YOLO permission toggle', () => {
    expect(dshChatUIConfig.getPermissionModeToggle!()).toEqual({
      inactiveValue: 'normal',
      inactiveLabel: expect.any(String),
      activeValue: 'yolo',
      activeLabel: 'YOLO',
    });
  });

  it('projects only native catalog metadata and preserves the pinned missing selection', () => {
    const id = encodeDshModelId('native', 'model');
    const pinned = encodeDshModelId('native', 'old');
    const settings = { providerConfigs: { dsh: {
      models: [{ provider: 'native', model: 'model', label: 'Real model', contextWindow: 12345, reasoning: ['low', 'high'] }],
      selectedModel: pinned,
    } } };
    expect(dshChatUIConfig.getModelOptions(settings).map(option => option.value)).toEqual([id, pinned]);
    expect(dshChatUIConfig.getReasoningOptions(id, settings)).toEqual([
      { label: 'low', value: 'low' }, { label: 'high', value: 'high' },
    ]);
    expect(dshChatUIConfig.getReasoningOptions(pinned, settings)).toEqual([]);
    expect(dshChatUIConfig.getContextWindowSize(id, {}, settings)).toBe(12345);
    expect(dshChatUIConfig.ownsModel('codex/model', settings)).toBe(false);
  });

  it('persists selection only for models it owns and clamps effort to catalog values', () => {
    const id = encodeDshModelId('native', 'model');
    const settings: Record<string, unknown> = { model: 'codex/model', effortLevel: 'invented', providerConfigs: { dsh: {
      models: [{ provider: 'native', model: 'model', label: 'Model', reasoning: ['low'] }],
    } } };
    dshChatUIConfig.applyModelDefaults('codex/other', settings);
    expect(settings.model).toBe('codex/model');
    dshChatUIConfig.applyModelDefaults(id, settings);
    expect(settings.model).toBe(id);
    expect(settings.effortLevel).toBe('low');
    expect(settings.providerConfigs).toMatchObject({ dsh: { selectedModel: id } });
  });

  it('keeps the native default selectable when a catalog exists without an explicit selection', () => {
    const settings = { providerConfigs: { dsh: { models: [{ provider: 'native', model: 'one', label: 'One' }] } } };
    const defaultModel = dshChatUIConfig.getDefaultModel?.(settings);
    expect(dshChatUIConfig.getModelOptions(settings).some(option => option.value === defaultModel)).toBe(true);
  });

  it('shows the catalog default model name while retaining native default routing', () => {
    const settings = { providerConfigs: { dsh: { models: [
      { provider: 'native', model: 'flash', label: 'DeepSeek Flash', isDefault: true },
      { provider: 'native', model: 'pro', label: 'DeepSeek Pro' },
    ] } } };
    expect(dshChatUIConfig.getModelOptions(settings).find(option => option.value === 'dsh/default'))
      .toEqual({ value: 'dsh/default', label: 'DeepSeek Flash (Harness default)' });
    expect(dshChatUIConfig.getDefaultModel?.(settings)).toBe('dsh/default');
    expect(dshChatUIConfig.getModelOptions(settings).find(option => option.value === 'dsh/native/pro')?.label)
      .toBe('DeepSeek Pro');
  });

  it('does not guess a default model from catalog order', () => {
    const settings = { providerConfigs: { dsh: { models: [
      { provider: 'native', model: 'flash', label: 'DeepSeek Flash', isDefault: 'true' },
    ] } } };
    expect(dshChatUIConfig.getModelOptions(settings).find(option => option.value === 'dsh/default')?.label)
      .toBe('DeepSeek Harness native default');
  });

  it('uses native default reasoning metadata rather than the first advertised effort', () => {
    const settings = { providerConfigs: { dsh: { models: [{
      provider: 'native', model: 'one', label: 'One', reasoning: ['off', 'high'], defaultReasoning: 'high',
    }] } } };
    expect(dshChatUIConfig.getDefaultReasoningValue('dsh/native/one', settings)).toBe('high');
    dshChatUIConfig.applyModelDefaults('dsh/native/one', settings);
    expect(settings).toMatchObject({ effortLevel: 'high' });
  });
});
