import { isMemoryDuplicate } from './deduplication';
import { escapePromptTagCloser, wrapMemoryInjection } from './memoryPrompt';
import type { MemoryStore } from './MemoryStore';
import type { DurableMindEntry, HybridMindInjectionResult, MindRecallInfo } from './mind-types';
import type { MindStore } from './MindStore';
import type { MemoryEntry } from './types';
import {
  DEFAULT_MEMORY_MAX_GLOBAL_INJECTION_CHARS,
  DEFAULT_MEMORY_MAX_INJECTION_CHARS,
  DEFAULT_MEMORY_MAX_PROJECT_INJECTION_CHARS,
} from './types';

export interface MindPromptContext {
  activeFilePath?: string;
  userPromptText?: string;
}

export interface HybridMindInjectorConfig {
  maxTotalChars?: number;
  maxGlobalChars?: number;
  maxProjectChars?: number;
  getMemoryStore?: () => MemoryStore | null;
  isMemoryStoreEnabled?: () => boolean;
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
  private maxTotalChars: number;
  private maxGlobalChars: number;
  private maxProjectChars: number;
  private readonly getMemoryStore?: () => MemoryStore | null;
  private readonly isMemoryStoreEnabled?: () => boolean;

  constructor(
    private readonly mindStore: MindStore,
    config?: HybridMindInjectorConfig,
  ) {
    this.maxTotalChars = config?.maxTotalChars ?? DEFAULT_MEMORY_MAX_INJECTION_CHARS;
    this.maxGlobalChars = config?.maxGlobalChars ?? DEFAULT_MEMORY_MAX_GLOBAL_INJECTION_CHARS;
    this.maxProjectChars = config?.maxProjectChars ?? DEFAULT_MEMORY_MAX_PROJECT_INJECTION_CHARS;
    this.getMemoryStore = config?.getMemoryStore;
    this.isMemoryStoreEnabled = config?.isMemoryStoreEnabled;
  }

  /** Update budgets at runtime (e.g. when settings change on a cached instance). */
  updateConfig(config: Pick<HybridMindInjectorConfig, 'maxTotalChars' | 'maxGlobalChars' | 'maxProjectChars'>): void {
    if (config.maxTotalChars !== undefined) {
      this.maxTotalChars = config.maxTotalChars;
    }
    if (config.maxGlobalChars !== undefined) {
      this.maxGlobalChars = config.maxGlobalChars;
    }
    if (config.maxProjectChars !== undefined) {
      this.maxProjectChars = config.maxProjectChars;
    }
  }

  async resolveInjection(context: MindPromptContext): Promise<HybridMindInjectionResult> {
    const globalEntries = await this.mindStore.listDurable('global', 'active');
    const projectEntries = await this.mindStore.listDurable('project', 'active');

    const sections: string[] = [];
    const recalledEntries: MindRecallInfo[] = [];
    let totalInjectedLength = 0;

    // --- Layer 1: Dynamic Project Rules & Habits (Highest Priority) ---
    if (projectEntries.length > 0) {
      const activePath = context.activeFilePath ?? '';
      const userPrompt = (context.userPromptText ?? '').toLowerCase();

      // Targeted matches are scoped to the current file or prompt; untargeted
      // entries match every turn. Keeping them in separate queues stops a
      // confident always-on rule from outrunning a path-specific one.
      const targetedEntries: DurableMindEntry[] = [];
      const untargetedEntries: DurableMindEntry[] = [];

      for (const entry of projectEntries) {
        // Check path patterns
        if (activePath && entry.matchPatterns && entry.matchPatterns.length > 0) {
          let patternMatched = false;
          for (const pattern of entry.matchPatterns) {
            if (matchGlob(pattern, activePath)) {
              patternMatched = true;
              break;
            }
          }
          if (patternMatched) {
            targetedEntries.push(entry);
            continue;
          }
        }

        // Check tags against prompt or path
        if (entry.tags && entry.tags.length > 0) {
          let tagMatched = false;
          for (const tag of entry.tags) {
            const normTag = tag.trim().toLowerCase();
            if (normTag && (userPrompt.includes(normTag) || activePath.toLowerCase().includes(normTag))) {
              tagMatched = true;
              break;
            }
          }
          if (tagMatched) {
            targetedEntries.push(entry);
            continue;
          }
        }

        // Entries without targeting metadata (e.g. added via /remember or
        // pin-to-mind) apply project-wide; without this fallback they would
        // never reach the prompt.
        const hasTargeting = (entry.matchPatterns?.length ?? 0) > 0 || (entry.tags?.length ?? 0) > 0;
        if (!hasTargeting) {
          untargetedEntries.push(entry);
        }
      }

      const matchedEntries = [
        ...targetedEntries.sort((a, b) => b.confidence - a.confidence),
        ...untargetedEntries.sort((a, b) => b.confidence - a.confidence),
      ];

      if (matchedEntries.length > 0) {
        const projectLines: string[] = [];
        let currentLen = 0;
        const projectLimit = Math.min(this.maxProjectChars, this.maxTotalChars - totalInjectedLength);

        for (const entry of matchedEntries) {
          const line = `- [${entry.category}] ${entry.content}`;
          if (currentLen + line.length > projectLimit && projectLines.length > 0) {
            break;
          }
          projectLines.push(line);
          currentLen += line.length;

          recalledEntries.push({
            id: entry.id,
            category: entry.category,
            scope: entry.scope,
            content: entry.content,
            confidence: entry.confidence,
            tags: entry.tags,
          });

          // Record hit asynchronously
          void this.mindStore.recordHit(entry.id);
        }

        if (projectLines.length > 0) {
          const block = `<project_context_rules>\n${escapePromptTagCloser(projectLines.join('\n'), 'project_context_rules')}\n</project_context_rules>`;
          sections.push(block);
          totalInjectedLength += block.length;
        }
      }
    }

    // --- Layer 2: Global Core Profile ---
    if (globalEntries.length > 0 && totalInjectedLength < this.maxTotalChars) {
      // Sort by confidence descending
      const sortedGlobal = [...globalEntries].sort((a, b) => b.confidence - a.confidence);
      const globalLines: string[] = [];
      let currentLen = 0;
      const globalLimit = Math.min(this.maxGlobalChars, this.maxTotalChars - totalInjectedLength);

      for (const entry of sortedGlobal) {
        const line = `- [${entry.category}] ${entry.content}`;
        if (currentLen + line.length > globalLimit && globalLines.length > 0) {
          break;
        }
        globalLines.push(line);
        currentLen += line.length;
        recalledEntries.push({
          id: entry.id,
          category: entry.category,
          scope: entry.scope,
          content: entry.content,
          confidence: entry.confidence,
          tags: entry.tags,
        });
      }

      if (globalLines.length > 0) {
        const block = `<user_mind_profile>\n${escapePromptTagCloser(globalLines.join('\n'), 'user_mind_profile')}\n</user_mind_profile>`;
        sections.push(block);
        totalInjectedLength += block.length;
      }
    }

    // --- Layer 3: Non-Duplicate Vault Memory Markdown (memory.md) ---
    const isMemoryEnabled = this.isMemoryStoreEnabled ? this.isMemoryStoreEnabled() : true;
    const memoryStore = this.getMemoryStore?.();
    if (isMemoryEnabled && memoryStore && totalInjectedLength < this.maxTotalChars) {
      const memoryEntries = await memoryStore.load();
      const uniqueMemoryEntries = memoryEntries.filter(
        (entry) => !isMemoryDuplicate(entry.content, recalledEntries),
      );

      if (uniqueMemoryEntries.length > 0) {
        const remainingBudget = this.maxTotalChars - totalInjectedLength;
        const memoryText = this.buildMemorySectionText(uniqueMemoryEntries, remainingBudget);
        if (memoryText) {
          sections.push(wrapMemoryInjection(memoryText));
        }
      }
    }

    return {
      injectionText: sections.join('\n\n'),
      recalledEntries,
    };
  }

  async buildPromptInjection(context: MindPromptContext): Promise<string> {
    const result = await this.resolveInjection(context);
    return result.injectionText;
  }

  private buildMemorySectionText(entries: MemoryEntry[], maxChars: number): string | null {
    const grouped = new Map<string, string[]>();
    for (const entry of entries) {
      const items = grouped.get(entry.category) || [];
      items.push(entry.content);
      grouped.set(entry.category, items);
    }

    let text = '';
    for (const [category, items] of grouped) {
      const heading = `### ${category}\n`;
      if (text.length + heading.length > maxChars) {
        break;
      }
      text += heading;

      for (const item of items) {
        const line = `- ${item}\n`;
        if (text.length + line.length > maxChars) {
          return text.trim() || null;
        }
        text += line;
      }
    }

    return text.trim() || null;
  }
}
