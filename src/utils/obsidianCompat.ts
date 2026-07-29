import type { App, TFile, Workspace, WorkspaceLeaf } from 'obsidian';

/** Resolves the document for the active Obsidian window without breaking node-based tests. */
export function getActiveDocument(): Document | null {
  try {
    if (typeof activeDocument !== 'undefined' && activeDocument) {
      return activeDocument;
    }
  } catch {
    // The Obsidian window globals are absent in headless contexts.
  }
  return typeof window !== 'undefined' ? window.document : null;
}

export function getVaultFileByPath(app: App, filePath: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (isVaultFile(file)) {
    return file;
  }
  return null;
}

export async function revealWorkspaceLeaf(workspace: Workspace, leaf: WorkspaceLeaf): Promise<void> {
  await workspace.revealLeaf(leaf);
}

function isVaultFile(value: unknown): value is TFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TFile>;
  return typeof candidate.path === 'string'
    && typeof candidate.basename === 'string';
}
