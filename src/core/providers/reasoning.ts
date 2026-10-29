import type { ProviderReasoningOption } from './types';

export const DEFAULT_REASONING_VALUE = 'high';

/** Canonical weakest-to-strongest ranking; providers may name the same rung differently. */
const REASONING_RANKS: Record<string, number> = {
  none: 0,
  off: 0,
  minimal: 1,
  light: 2,
  low: 3,
  medium: 4,
  high: 5,
  on: 5,
  xhigh: 6,
  max: 7,
  ultra: 8,
};

export function getReasoningRank(value: string): number | null {
  const key = value.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(REASONING_RANKS, key)) {
    return null;
  }
  return REASONING_RANKS[key];
}

/**
 * Sorts known rungs weakest to strongest while leaving provider-specific ids in
 * the slots the adapter chose, so an unrecognised ladder keeps its own order.
 */
export function orderReasoningOptions(
  options: readonly ProviderReasoningOption[],
): ProviderReasoningOption[] {
  const rankedSlots: number[] = [];
  const ranked: ProviderReasoningOption[] = [];

  options.forEach((option, index) => {
    if (getReasoningRank(option.value) !== null) {
      rankedSlots.push(index);
      ranked.push(option);
    }
  });

  const ordered = [...ranked].sort(
    (a, b) => (getReasoningRank(a.value) ?? 0) - (getReasoningRank(b.value) ?? 0),
  );
  const result = [...options];
  rankedSlots.forEach((slot, index) => {
    result[slot] = ordered[index];
  });
  return result;
}

/**
 * Title-cases a rung name, but only when the adapter gave us the raw id as its
 * label. Provider-authored copy ("Max (deep)") is left untouched.
 */
export function normalizeReasoningLabel(option: ProviderReasoningOption): string {
  const label = option.label?.trim() ?? '';
  const value = option.value.trim();
  if (!label || label.toLowerCase() === value.toLowerCase()) {
    return formatReasoningValueLabel(value);
  }
  return label;
}

/** Applies {@link normalizeReasoningLabel} to a whole ladder without reordering it. */
export function normalizeReasoningOptions(
  options: readonly ProviderReasoningOption[],
): ProviderReasoningOption[] {
  return options.map(option => ({ ...option, label: normalizeReasoningLabel(option) }));
}

/** Position of a rung on the 0..1 ramp, or null when the index is out of range. */
export function getReasoningTint(index: number, length: number): number | null {
  if (length <= 0 || index < 0 || index >= length) {
    return null;
  }
  if (length === 1) {
    return 1;
  }
  return index / (length - 1);
}

export function formatReasoningValueLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.toLowerCase() === 'xhigh') {
    return 'xHigh';
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function resolvePreferredReasoningDefault(
  availableValues: readonly string[],
  fallbackValue: string,
): string {
  if (availableValues.includes(DEFAULT_REASONING_VALUE)) {
    return DEFAULT_REASONING_VALUE;
  }
  if (availableValues.includes(fallbackValue)) {
    return fallbackValue;
  }
  return availableValues[0] ?? fallbackValue;
}
