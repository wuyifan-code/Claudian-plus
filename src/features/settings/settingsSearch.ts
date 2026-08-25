export interface SettingsSearchEntry {
  categoryId: string;
  categoryLabel?: string;
  settingKey: string;
  name: string;
  desc?: string;
  targetEl?: HTMLElement;
}

export interface SettingsSearchResult {
  entry: SettingsSearchEntry;
  score: number;
  matchType: 'name' | 'desc';
}

/**
 * Searches settings entries by case-insensitive substring match in name or description.
 * Name hits rank higher than description hits.
 */
export function searchSettings(
  query: string,
  entries: SettingsSearchEntry[]
): SettingsSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SettingsSearchResult[] = [];

  for (const entry of entries) {
    const nameLower = entry.name.toLowerCase();
    const descLower = (entry.desc ?? '').toLowerCase();

    const nameIndex = nameLower.indexOf(q);
    if (nameIndex !== -1) {
      results.push({
        entry,
        score: 100 - nameIndex,
        matchType: 'name',
      });
      continue;
    }

    if (descLower) {
      const descIndex = descLower.indexOf(q);
      if (descIndex !== -1) {
        results.push({
          entry,
          score: 50 - descIndex,
          matchType: 'desc',
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
