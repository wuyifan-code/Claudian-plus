export interface DshModel {
  provider: string;
  model: string;
  label: string;
  isDefault?: boolean;
  contextWindow?: number;
  reasoning?: string[];
  defaultReasoning?: string;
}

export const DSH_DEFAULT_MODEL_ID = 'dsh/default';

export function encodeDshModelId(provider: string, model: string): string {
  return `dsh/${encodeURIComponent(provider)}/${encodeURIComponent(model)}`;
}

export function decodeDshModelId(value: string): { provider: string; model: string } | null {
  const parts = value.split('/');
  if (parts.length !== 3 || parts[0] !== 'dsh') return null;
  try {
    const provider = decodeURIComponent(parts[1]);
    const model = decodeURIComponent(parts[2]);
    return provider.trim() && model.trim() ? { provider, model } : null;
  } catch {
    return null;
  }
}

export function isDshModelId(value: string): boolean {
  return value === DSH_DEFAULT_MODEL_ID || decodeDshModelId(value) !== null;
}

export function normalizeDshModels(value: unknown): DshModel[] {
  if (!Array.isArray(value)) return [];
  const models: DshModel[] = [];
  const seen = new Set<string>();
  for (const candidate of value as unknown[]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.provider !== 'string' || !entry.provider.trim()
      || typeof entry.model !== 'string' || !entry.model.trim()) continue;
    const provider = entry.provider.trim();
    const model = entry.model.trim();
    const key = encodeDshModelId(provider, model);
    if (seen.has(key)) continue;
    seen.add(key);
    const normalized: DshModel = {
      provider, model,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : model,
    };
    if (entry.isDefault === true) normalized.isDefault = true;
    if (typeof entry.contextWindow === 'number' && Number.isFinite(entry.contextWindow) && entry.contextWindow > 0) {
      normalized.contextWindow = Math.floor(entry.contextWindow);
    }
    if (Array.isArray(entry.reasoning)) {
      normalized.reasoning = [...new Set<string>((entry.reasoning as unknown[]).filter(
        (level: unknown): level is string => typeof level === 'string' && !!level.trim(),
      ))];
      if (typeof entry.defaultReasoning === 'string' && normalized.reasoning.includes(entry.defaultReasoning)) {
        normalized.defaultReasoning = entry.defaultReasoning;
      }
    }
    models.push(normalized);
  }
  return models;
}
