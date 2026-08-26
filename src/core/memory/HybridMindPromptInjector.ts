import type { DurableMindEntry } from './mind-types';
import type { MindStore } from './MindStore';

export interface MindPromptContext {
  activeFilePath?: string;
  userPromptText?: string;
}

export interface HybridMindInjectorConfig {
  maxGlobalChars?: number;
  maxProjectChars?: number;
}

function matchGlob(pattern: string, filePath: string): boolean {
  if (!pattern || !filePath) return false;
  // Normalize windows backslashes
  const normPath = filePath.replace(/\\/g, '/');
  const normPattern = pattern.replace(/\\/g, '/');

  if (normPattern === '*' || normPattern === '**') return true;

  // Convert simple glob to RegExp
  const regexStr = normPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___GLOBSTAR___/g, '.*');

  try {
    const regex = new RegExp(`^${regexStr}$`, 'i');
    return regex.test(normPath) || normPath.includes(normPattern.replace(/\*/g, ''));
  } catch {
    return normPath.includes(normPattern);
  }
}

export class HybridMindPromptInjector {
  private readonly maxGlobalChars: number;
  private readonly maxProjectChars: number;

  constructor(
    private readonly mindStore: MindStore,
    config?: HybridMindInjectorConfig,
  ) {
    this.maxGlobalChars = config?.maxGlobalChars ?? 180;
    this.maxProjectChars = config?.maxProjectChars ?? 350;
  }

  async buildPromptInjection(context: MindPromptContext): Promise<string> {
    const globalEntries = await this.mindStore.listDurable('global', 'active');
    const projectEntries = await this.mindStore.listDurable('project', 'active');

    const sections: string[] = [];

    // --- Layer 1: Global Core Profile ---
    if (globalEntries.length > 0) {
      // Sort by confidence descending
      const sortedGlobal = [...globalEntries].sort((a, b) => b.confidence - a.confidence);
      const globalLines: string[] = [];
      let currentLen = 0;

      for (const entry of sortedGlobal) {
        const line = `- [${entry.category}] ${entry.content}`;
        if (currentLen + line.length > this.maxGlobalChars && globalLines.length > 0) {
          break;
        }
        globalLines.push(line);
        currentLen += line.length;
      }

      if (globalLines.length > 0) {
        sections.push(`<user_mind_profile>\n${globalLines.join('\n')}\n</user_mind_profile>`);
      }
    }

    // --- Layer 2: Dynamic Project Rules & Habits ---
    if (projectEntries.length > 0) {
      const activePath = context.activeFilePath ?? '';
      const userPrompt = (context.userPromptText ?? '').toLowerCase();

      const matchedEntries: DurableMindEntry[] = [];

      for (const entry of projectEntries) {
        let isMatched = false;

        // Check path patterns
        if (activePath && entry.matchPatterns && entry.matchPatterns.length > 0) {
          for (const pattern of entry.matchPatterns) {
            if (matchGlob(pattern, activePath)) {
              isMatched = true;
              break;
            }
          }
        }

        // Check tags against prompt or path
        if (!isMatched && entry.tags && entry.tags.length > 0) {
          for (const tag of entry.tags) {
            const normTag = tag.trim().toLowerCase();
            if (normTag && (userPrompt.includes(normTag) || activePath.toLowerCase().includes(normTag))) {
              isMatched = true;
              break;
            }
          }
        }

        if (isMatched) {
          matchedEntries.push(entry);
        }
      }

      if (matchedEntries.length > 0) {
        matchedEntries.sort((a, b) => b.confidence - a.confidence);
        const projectLines: string[] = [];
        let currentLen = 0;

        for (const entry of matchedEntries) {
          const line = `- [${entry.category}] ${entry.content}`;
          if (currentLen + line.length > this.maxProjectChars && projectLines.length > 0) {
            break;
          }
          projectLines.push(line);
          currentLen += line.length;

          // Record hit asynchronously
          void this.mindStore.recordHit(entry.id);
        }

        if (projectLines.length > 0) {
          sections.push(`<project_context_rules>\n${projectLines.join('\n')}\n</project_context_rules>`);
        }
      }
    }

    return sections.join('\n\n');
  }
}
