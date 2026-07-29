import type { App } from 'obsidian';

import type { CanvasData, CanvasWritePlan } from './canvas';
import { applyCanvasWritePlan, diffCanvasWritePlan, formatCanvasForPrompt, readCanvas, serializeCanvasData } from './canvas';
import { commitCanvasWrite } from './CanvasWriteHistory';
import {
  detectPropertyInconsistencies,
  diffPropertiesWrite,
  formatPropertiesForPrompt,
  readProperties,
  writeProperties,
  writePropertiesBatch,
} from './properties';

export type {
  CanvasData,
  CanvasEdge,
  CanvasEdgeOperation,
  CanvasNode,
  CanvasNodeOperation,
  CanvasReadResult,
  CanvasWritePlan,
} from './canvas';
export type {
  FrontmatterRecord,
  PropertiesBatchOperation,
  PropertiesReadResult,
  PropertiesSetOperation,
} from './properties';

// ---------------------------------------------------------------------------
// ObsidianContextService — unified entry point for provider turn preparation
// ---------------------------------------------------------------------------

export interface ObsidianRichContext {
  /** Summaries of canvas files explicitly referenced in this turn. */
  canvasSummaries: string[];
  /** Summaries of property reads explicitly triggered in this turn. */
  propertySummaries: string[];
}

/**
 * Produces rich Obsidian-native context for injection into the agent prompt.
 *
 * Currently handles:
 * - Canvas files explicitly mentioned via @mention in the user's message.
 * - Property reads for files explicitly requested.
 *
 * Future: semantic vault search results (Phase 1.4).
 */
export async function buildObsidianRichContext(
  app: App,
  referencedCanvasPaths: string[],
  referencedPropertyPaths: string[],
): Promise<ObsidianRichContext> {
  const canvasSummaries: string[] = [];
  const propertySummaries: string[] = [];

  for (const path of referencedCanvasPaths) {
    try {
      const result = await readCanvas(app.vault, path);
      canvasSummaries.push(formatCanvasForPrompt(result));
    } catch {
      // Canvas file may have been deleted or is inaccessible; skip gracefully
    }
  }

  for (const path of referencedPropertyPaths) {
    try {
      const result = readProperties(app, path);
      propertySummaries.push(formatPropertiesForPrompt(result));
    } catch {
      // File may have been deleted or is inaccessible; skip gracefully
    }
  }

  return { canvasSummaries, propertySummaries };
}

/**
 * Appends rich Obsidian context sections to an existing prompt string.
 */
export function appendObsidianContext(prompt: string, context: ObsidianRichContext): string {
  const sections: string[] = [prompt];

  if (context.canvasSummaries.length > 0) {
    sections.push(...context.canvasSummaries);
  }

  if (context.propertySummaries.length > 0) {
    sections.push(...context.propertySummaries);
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Re-export core operations for direct use by provider runtimes and UI
// ---------------------------------------------------------------------------

export {
  applyCanvasWritePlan,
  detectPropertyInconsistencies,
  diffCanvasWritePlan,
  diffPropertiesWrite,
  formatCanvasForPrompt,
  formatPropertiesForPrompt,
  readCanvas,
  readProperties,
  serializeCanvasData,
  writeProperties,
  writePropertiesBatch,
};

/**
 * Writes a Canvas write plan back to disk after user confirmation.
 */
export async function commitCanvasWritePlan(
  app: App,
  canvasPath: string,
  plan: CanvasWritePlan,
  expectedCurrent?: CanvasData,
): Promise<void> {
  await commitCanvasWrite(app.vault, canvasPath, plan, expectedCurrent);
}
