import {
  DEFAULT_REASONING_VALUE,
  formatReasoningValueLabel,
  getReasoningRank,
  getReasoningTint,
  normalizeReasoningLabel,
  normalizeReasoningOptions,
  orderReasoningOptions,
  resolvePreferredReasoningDefault,
} from '@/core/providers/reasoning';
import type { ProviderReasoningOption } from '@/core/providers/types';

function options(...values: string[]): ProviderReasoningOption[] {
  return values.map(value => ({ value, label: formatReasoningValueLabel(value) }));
}

function values(list: readonly ProviderReasoningOption[]): string[] {
  return list.map(option => option.value);
}

describe('reasoning ladder', () => {
  it('keeps the existing helpers intact', () => {
    expect(DEFAULT_REASONING_VALUE).toBe('high');
    expect(resolvePreferredReasoningDefault(['low', 'high'], 'low')).toBe('high');
  });

  describe('getReasoningRank', () => {
    it.each([
      ['none', 0],
      ['off', 0],
      ['minimal', 1],
      ['light', 2],
      ['low', 3],
      ['medium', 4],
      ['high', 5],
      ['on', 5],
      ['xhigh', 6],
      ['max', 7],
      ['ultra', 8],
    ])('ranks %p as %p', (value, rank) => {
      expect(getReasoningRank(value)).toBe(rank);
    });

    it('is case and whitespace insensitive', () => {
      expect(getReasoningRank(' HIGH ')).toBe(5);
      expect(getReasoningRank('XHigh')).toBe(6);
    });

    it('returns null for provider-specific identifiers', () => {
      expect(getReasoningRank('think-harder')).toBeNull();
      expect(getReasoningRank('')).toBeNull();
    });
  });

  describe('orderReasoningOptions', () => {
    it('sorts a shuffled ladder weakest to strongest', () => {
      expect(values(orderReasoningOptions(options('max', 'low', 'high', 'medium'))))
        .toEqual(['low', 'medium', 'high', 'max']);
    });

    it('moves off/none to the front even when the adapter lists it last', () => {
      expect(values(orderReasoningOptions(options('high', 'off', 'medium'))))
        .toEqual(['off', 'medium', 'high']);
    });

    it('keeps unknown identifiers in their original slots', () => {
      expect(values(orderReasoningOptions(options('foo', 'high', 'bar', 'low'))))
        .toEqual(['foo', 'low', 'bar', 'high']);
    });

    it('is a stable no-op for an all-unknown ladder', () => {
      const unknown = options('b-mode', 'a-mode', 'c-mode');
      expect(values(orderReasoningOptions(unknown))).toEqual(['b-mode', 'a-mode', 'c-mode']);
    });

    it('does not mutate the input array', () => {
      const input = options('max', 'low');
      orderReasoningOptions(input);
      expect(values(input)).toEqual(['max', 'low']);
    });

    it('preserves option metadata', () => {
      const input: ProviderReasoningOption[] = [
        { value: 'max', label: 'Max', description: 'strongest', tokens: 64_000 },
        { value: 'low', label: 'Low' },
      ];
      expect(orderReasoningOptions(input)[1]).toBe(input[0]);
    });
  });

  describe('normalizeReasoningOptions', () => {
    it('title-cases adapters that echo the raw id as the label', () => {
      const result = normalizeReasoningOptions([
        { value: 'low', label: 'low' },
        { value: 'high', label: 'high' },
        { value: 'max', label: 'max' },
      ]);
      expect(result.map(option => option.label)).toEqual(['Low', 'High', 'Max']);
    });

    it('keeps the xHigh spelling', () => {
      expect(normalizeReasoningLabel({ value: 'xhigh', label: 'xhigh' })).toBe('xHigh');
    });

    it('fills a missing or blank label from the value', () => {
      expect(normalizeReasoningLabel({ value: 'medium', label: '' })).toBe('Medium');
      expect(normalizeReasoningLabel({ value: 'ultra', label: '  ' })).toBe('Ultra');
    });

    it('leaves provider-authored copy alone', () => {
      expect(normalizeReasoningLabel({ value: 'max', label: 'Max (deep)' })).toBe('Max (deep)');
      expect(normalizeReasoningLabel({ value: 'custom', label: 'Think harder' })).toBe('Think harder');
    });

    it('does not reorder the ladder', () => {
      const input = [
        { value: 'max', label: 'max' },
        { value: 'low', label: 'low' },
      ];
      expect(normalizeReasoningOptions(input).map(option => option.value)).toEqual(['max', 'low']);
    });

    it('works for ladders of any length', () => {
      const three = normalizeReasoningOptions([
        { value: 'low', label: 'low' },
        { value: 'high', label: 'high' },
        { value: 'max', label: 'max' },
      ]);
      const nine = normalizeReasoningOptions([
        'none', 'minimal', 'light', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
      ].map(value => ({ value, label: value })));

      expect(three).toHaveLength(3);
      expect(nine).toHaveLength(9);
      expect(nine.map(option => option.label)).toEqual([
        'None', 'Minimal', 'Light', 'Low', 'Medium', 'High', 'xHigh', 'Max', 'Ultra',
      ]);
    });
  });

  describe('getReasoningTint', () => {
    it('maps the ladder ends to 0 and 1', () => {
      expect(getReasoningTint(0, 5)).toBe(0);
      expect(getReasoningTint(4, 5)).toBe(1);
      expect(getReasoningTint(2, 5)).toBe(0.5);
    });

    it('returns 1 for a single-step ladder', () => {
      expect(getReasoningTint(0, 1)).toBe(1);
    });

    it('returns null for an invalid index', () => {
      expect(getReasoningTint(-1, 5)).toBeNull();
      expect(getReasoningTint(5, 5)).toBeNull();
      expect(getReasoningTint(0, 0)).toBeNull();
    });
  });
});
