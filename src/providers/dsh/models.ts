export const DSH_SYNTHETIC_MODEL_ID = 'dsh';
export const DSH_MODEL_PREFIX = 'dsh:';

export interface DshDiscoveredModel {
  label?: string;
  rawId: string;
  contextWindow?: number;
}

/**
 * Fallback catalog used when the DSH profile cannot be read. Model ids must
 * match the models registered by the llm adapter in the profile.
 */
export const DSH_DEFAULT_MODELS: ReadonlyArray<{ label: string; rawId: string; contextWindow?: number }> = Object.freeze([
  { label: 'DeepSeek V4 Pro', rawId: 'deepseek-v4-pro', contextWindow: 128_000 },
  { label: 'DeepSeek V4 Flash', rawId: 'deepseek-v4-flash', contextWindow: 128_000 },
]);

export function isDshModelSelectionId(model: string): boolean {
  return model === DSH_SYNTHETIC_MODEL_ID || model.startsWith(DSH_MODEL_PREFIX);
}

export function encodeDshModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${DSH_MODEL_PREFIX}${normalized}` : DSH_SYNTHETIC_MODEL_ID;
}

export function decodeDshModelId(model: string): string | null {
  if (!model.startsWith(DSH_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(DSH_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeDshDiscoveredModels(value: unknown): DshDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: DshDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const rawId = typeof record.rawId === 'string' ? record.rawId.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const contextWindow = typeof record.contextWindow === 'number'
      && Number.isFinite(record.contextWindow)
      && record.contextWindow > 0
      ? record.contextWindow
      : undefined;

    if (!rawId || seen.has(rawId)) {
      continue;
    }

    seen.add(rawId);
    normalized.push({
      ...(label ? { label } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      rawId,
    });
  }

  return normalized;
}

export function normalizeDshVisibleModels(value: unknown): string[] {
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

export function normalizeDshModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(value as Record<string, unknown>)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const normalizedRawId = rawId.trim();
    const normalizedAlias = alias.trim();
    if (!normalizedRawId || !normalizedAlias) {
      continue;
    }

    normalized[normalizedRawId] = normalizedAlias;
  }

  return normalized;
}

export function buildDshPickerModels(
  discoveredModels: DshDiscoveredModel[],
  visibleModels: string[],
): Array<{ description?: string; id: string; isAvailable: boolean; name: string }> {
  const discoveredByRawId = new Map(discoveredModels.map((model) => [model.rawId, model]));
  const catalog: Array<{ label: string; rawId: string }> = discoveredModels.length > 0
    ? discoveredModels.map((model) => ({ label: model.label ?? model.rawId, rawId: model.rawId }))
    : [...DSH_DEFAULT_MODELS];
  const catalogIds = new Set(catalog.map((model) => model.rawId));

  const models: Array<{ description?: string; id: string; isAvailable: boolean; name: string }> = [];
  for (const model of catalog) {
    const discovered = discoveredByRawId.get(model.rawId);
    models.push({
      ...(discovered?.contextWindow !== undefined
        ? { description: `${discovered.contextWindow.toLocaleString()} tokens context` }
        : {}),
      id: model.rawId,
      isAvailable: true,
      name: model.label,
    });
  }

  for (const rawId of visibleModels) {
    if (catalogIds.has(rawId)) {
      continue;
    }

    models.push({ id: rawId, isAvailable: false, name: rawId });
  }

  return models;
}
