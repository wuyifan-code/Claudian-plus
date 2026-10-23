import { buildUiContinuationPrompt, MAX_UI_CONTEXT_CHARS } from '@/features/chat/rendering/ui/followUp';

describe('buildUiContinuationPrompt', () => {
  it('returns the bare prompt when there is no widget context', () => {
    expect(buildUiContinuationPrompt('  Choose a bike  ', undefined)).toBe('Choose a bike');
    expect(buildUiContinuationPrompt('Choose a bike', null)).toBe('Choose a bike');
  });

  it('drops context that would serialize to nothing', () => {
    expect(buildUiContinuationPrompt('Go', {})).toBe('Go');
  });

  it('appends the widget payload behind an untrusted marker', () => {
    const result = buildUiContinuationPrompt('Plan my trip', { pace: 'packed', days: 3 });

    expect(result.startsWith('Plan my trip')).toBe(true);
    expect(result).toContain('<untrusted_ui_state>');
    expect(result).toContain('"pace":"packed"');
    expect(result.trimEnd().endsWith('</untrusted_ui_state>')).toBe(true);
  });

  it('bounds the serialized payload', () => {
    const huge = { note: 'x'.repeat(MAX_UI_CONTEXT_CHARS * 2) };
    const result = buildUiContinuationPrompt('Go', huge);

    expect(result.length).toBeLessThan(MAX_UI_CONTEXT_CHARS + 200);
    expect(result).toContain('<untrusted_ui_state>');
  });

  it('survives a payload that cannot be serialized', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(buildUiContinuationPrompt('Go', circular)).toBe('Go');
  });
});
