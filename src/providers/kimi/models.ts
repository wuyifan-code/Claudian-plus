export interface KimiDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface KimiBaseModel {
  description?: string;
  label: string;
  rawId: string;
  supportsThinking: boolean;
}

export interface KimiDiscoveredModelGroup {
  models: KimiBaseModel[];
  providerKey: string;
  providerLabel: string;
}

export const KIMI_SYNTHETIC_MODEL_ID = 'kimi';
export const KIMI_MODEL_PREFIX = 'kimi:';
export const KIMI_THINKING_SUFFIX = ',thinking';

export function isKimiModelSelectionId(model: string): boolean {
  return model === KIMI_SYNTHETIC_MODEL_ID || model.startsWith(KIMI_MODEL_PREFIX);
}

export function encodeKimiModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${KIMI_MODEL_PREFIX}${normalized}` : KIMI_SYNTHETIC_MODEL_ID;
}

export function decodeKimiModelId(model: string): string | null {
  if (!model.startsWith(KIMI_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(KIMI_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeKimiDiscoveredModels(value: unknown): KimiDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: KimiDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const rawId = typeof record.rawId === 'string' ? record.rawId.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : rawId;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!rawId || seen.has(rawId)) {
      continue;
    }

    seen.add(rawId);
    normalized.push({
      ...(description ? { description } : {}),
      label: label || rawId,
      rawId,
    });
  }

  return normalized;
}

export function normalizeKimiModelAliases(
  value: unknown,
  discoveredModels: KimiDiscoveredModel[] = [],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(value as Record<string, unknown>)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const normalizedRawId = resolveKimiBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedAlias = alias.trim();
    if (!normalizedRawId || !normalizedAlias) {
      continue;
    }

    normalized[normalizedRawId] = normalizedAlias;
  }

  return normalized;
}

export function normalizeKimiVisibleModels(
  value: unknown,
  _discoveredModels: KimiDiscoveredModel[] = [],
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function isKimiThinkingVariant(rawId: string): boolean {
  return rawId.trim().toLowerCase().endsWith(KIMI_THINKING_SUFFIX);
}

/**
 * Resolves a raw model id to its base id by stripping the `,thinking` suffix.
 * The suffix is a hard Kimi variant marker (confirmed by probing the ACP
 * model catalog), so stripping is unconditional; the discovered-model list is
 * accepted for call-site compatibility and ignored.
 */
export function resolveKimiBaseModelRawId(
  rawId: string,
  _discoveredModels: KimiDiscoveredModel[] | Set<string> = [],
): string {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return '';
  }

  const thinkingSuffixIndex = normalizedRawId.toLowerCase().lastIndexOf(KIMI_THINKING_SUFFIX);
  if (thinkingSuffixIndex <= 0) {
    return normalizedRawId;
  }

  return normalizedRawId.slice(0, thinkingSuffixIndex);
}

export function buildKimiBaseModels(models: KimiDiscoveredModel[]): KimiBaseModel[] {
  const discoveredRawIds = new Set(models.map((model) => model.rawId));
  const discoveredByRawId = new Map(models.map((model) => [model.rawId, model] as const));
  const grouped = new Map<string, KimiDiscoveredModel[]>();

  for (const model of models) {
    const baseRawId = resolveKimiBaseModelRawId(model.rawId, discoveredRawIds);
    const existing = grouped.get(baseRawId);
    if (existing) {
      existing.push(model);
    } else {
      grouped.set(baseRawId, [model]);
    }
  }

  return Array.from(grouped.entries())
    .map(([baseRawId, entries]) => {
      const baseModel = discoveredByRawId.get(baseRawId) ?? entries[0];
      return {
        ...(baseModel?.description ? { description: baseModel.description } : {}),
        label: baseModel?.label ?? baseRawId,
        rawId: baseRawId,
        supportsThinking: entries.some((entry) => isKimiThinkingVariant(entry.rawId)),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function groupKimiDiscoveredModels(
  models: KimiDiscoveredModel[],
): KimiDiscoveredModelGroup[] {
  const groups = new Map<string, KimiDiscoveredModelGroup>();
  for (const model of buildKimiBaseModels(models)) {
    // The provider prefix lives in the raw id (`kimi-code/k3`), while the
    // label is the bare model name.
    const { providerLabel } = splitKimiModelLabel(model.rawId || model.label);
    const providerKey = providerLabel.toLowerCase();
    const existing = groups.get(providerKey);
    if (existing) {
      existing.models.push(model);
      continue;
    }

    groups.set(providerKey, {
      models: [model],
      providerKey,
      providerLabel,
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      models: [...group.models].sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => left.providerLabel.localeCompare(right.providerLabel));
}

export function splitKimiModelLabel(label: string): {
  modelLabel: string;
  providerLabel: string;
} {
  const trimmed = label.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return {
      modelLabel: trimmed,
      providerLabel: 'Other',
    };
  }

  return {
    modelLabel: trimmed.slice(slashIndex + 1).trim(),
    providerLabel: trimmed.slice(0, slashIndex).trim(),
  };
}
