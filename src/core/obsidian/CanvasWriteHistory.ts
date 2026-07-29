import type { Vault } from 'obsidian';

import {
  applyCanvasWritePlan,
  type CanvasData,
  type CanvasWritePlan,
  diffCanvasWritePlan,
  readCanvas,
  serializeCanvasData,
} from './canvas';

interface CanvasWriteHistoryEntry {
  path: string;
  before: CanvasData;
  after: CanvasData;
  committedAt: number;
}

export interface CanvasWriteCommitResult {
  path: string;
  applied: true;
  diff: string;
  nodeCount: number;
  edgeCount: number;
}

export interface CanvasWriteUndoResult {
  path: string;
  reverted: true;
  nodeCount: number;
  edgeCount: number;
}

const MAX_HISTORY_ENTRIES = 20;
const histories = new WeakMap<object, CanvasWriteHistory>();

/**
 * Returns the in-memory write history for a vault.
 *
 * Keeping the history keyed by Vault makes all provider entry points share
 * the same undo stack without persisting sensitive Canvas snapshots to disk.
 */
export function getCanvasWriteHistory(vault: Vault): CanvasWriteHistory {
  const key = vault as unknown as object;
  const existing = histories.get(key);
  if (existing) return existing;
  const history = new CanvasWriteHistory();
  histories.set(key, history);
  return history;
}

export async function commitCanvasWrite(
  vault: Vault,
  canvasPath: string,
  plan: CanvasWritePlan,
  expectedCurrent?: CanvasData,
): Promise<CanvasWriteCommitResult> {
  return getCanvasWriteHistory(vault).commit(vault, canvasPath, plan, expectedCurrent);
}

export async function undoLastCanvasWrite(
  vault: Vault,
  canvasPath?: string,
  expectedAfter?: CanvasData,
): Promise<CanvasWriteUndoResult> {
  return getCanvasWriteHistory(vault).undo(vault, canvasPath, expectedAfter);
}

export class CanvasWriteHistory {
  private readonly entries: CanvasWriteHistoryEntry[] = [];

  async commit(
    vault: Vault,
    canvasPath: string,
    plan: CanvasWritePlan,
    expectedCurrent?: CanvasData,
  ): Promise<CanvasWriteCommitResult> {
    const current = (await readCanvas(vault, canvasPath)).data;
    if (expectedCurrent && serializeCanvasData(current) !== serializeCanvasData(expectedCurrent)) {
      throw new Error(
        `Canvas changed while the write was awaiting approval; refusing to overwrite ${canvasPath}.`,
      );
    }
    const updated = applyCanvasWritePlan(current, plan);
    const file = vault.getFileByPath(canvasPath);
    if (!file) throw new Error(`Canvas file not found: ${canvasPath}`);

    // Use Obsidian's Vault API so metadata, backlinks, and open Canvas views
    // receive the same change event as a normal user edit.
    await vault.modify(file, serializeCanvasData(updated));

    this.entries.push({
      path: canvasPath,
      before: cloneCanvasData(current),
      after: cloneCanvasData(updated),
      committedAt: Date.now(),
    });
    if (this.entries.length > MAX_HISTORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_HISTORY_ENTRIES);
    }

    return {
      path: canvasPath,
      applied: true,
      diff: diffCanvasWritePlan(current, plan),
      nodeCount: updated.nodes.length,
      edgeCount: updated.edges.length,
    };
  }

  async undo(
    vault: Vault,
    canvasPath?: string,
    expectedAfter?: CanvasData,
  ): Promise<CanvasWriteUndoResult> {
    const index = this.findLatestIndex(canvasPath);
    if (index < 0) {
      throw new Error(canvasPath
        ? `No Canvas write is available to undo for ${canvasPath}.`
        : 'No Canvas write is available to undo.');
    }

    const entry = this.entries[index];
    if (expectedAfter && serializeCanvasData(entry.after) !== serializeCanvasData(expectedAfter)) {
      throw new Error(
        `Canvas history changed after the panel write; refusing to undo a different write for ${entry.path}.`,
      );
    }
    const current = (await readCanvas(vault, entry.path)).data;
    if (serializeCanvasData(current) !== serializeCanvasData(entry.after)) {
      throw new Error(
        `Canvas changed after the last Claudian Plus write; refusing to overwrite ${entry.path}.`,
      );
    }

    const file = vault.getFileByPath(entry.path);
    if (!file) throw new Error(`Canvas file not found: ${entry.path}`);
    await vault.modify(file, serializeCanvasData(entry.before));
    this.entries.splice(index, 1);

    return {
      path: entry.path,
      reverted: true,
      nodeCount: entry.before.nodes.length,
      edgeCount: entry.before.edges.length,
    };
  }

  clear(): void {
    this.entries.length = 0;
  }

  private findLatestIndex(canvasPath?: string): number {
    if (!canvasPath) return this.entries.length - 1;
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (this.entries[index].path === canvasPath) return index;
    }
    return -1;
  }
}

function cloneCanvasData(data: CanvasData): CanvasData {
  return {
    nodes: data.nodes.map(node => ({ ...node })),
    edges: data.edges.map(edge => ({ ...edge })),
  };
}
