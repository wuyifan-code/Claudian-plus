import type { AcpSessionMode } from '../acp';

export interface KimiMode {
  description?: string;
  id: string;
  name: string;
}

export const KIMI_DEFAULT_MODE_ID = 'default';

export function normalizeKimiAvailableModes(value: unknown): KimiMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: KimiMode[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : id;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({
      ...(description ? { description } : {}),
      id,
      name: name || id,
    });
  }

  return normalized;
}

export function normalizeKimiAcpModes(modes: AcpSessionMode[] | null | undefined): KimiMode[] {
  return normalizeKimiAvailableModes(modes);
}
