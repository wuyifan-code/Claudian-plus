import type { App } from 'obsidian';

import type { CanvasData, CanvasWritePlan } from './canvas';
import { applyCanvasWritePlan, diffCanvasWritePlan, readCanvas, serializeCanvasData } from './canvas';
import { commitCanvasWrite } from './CanvasWriteHistory';
import { diffPropertiesWrite, readProperties, writeProperties } from './properties';

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
  PropertiesReadResult,
  PropertiesSetOperation,
} from './properties';

// ---------------------------------------------------------------------------
// Re-export core operations for direct use by provider runtimes and UI
// ---------------------------------------------------------------------------

export {
  applyCanvasWritePlan,
  diffCanvasWritePlan,
  diffPropertiesWrite,
  readCanvas,
  readProperties,
  serializeCanvasData,
  writeProperties,
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
