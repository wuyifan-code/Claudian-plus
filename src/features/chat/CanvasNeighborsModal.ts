import { type App, type Editor,Modal, Notice, setIcon, TFile } from 'obsidian';

import { applyCanvasWritePlan, type CanvasData, type CanvasNode, type CanvasWritePlan, diffCanvasWritePlan, readCanvas } from '../../core/obsidian/canvas';
import { buildCanvasNeighborWritePlan } from '../../core/obsidian/canvasNeighborPlan';
import { buildCanvasNeighborSuggestions, type CanvasNeighborSuggestion } from '../../core/obsidian/canvasNeighbors';
import { commitCanvasWrite, undoLastCanvasWrite } from '../../core/obsidian/CanvasWriteHistory';
import { confirm } from '../../shared/modals/ConfirmModal';
import type { CanvasSelectionContext } from '../../utils/canvas';

/** A small, source-backed graph panel for Canvas selections. */
export class CanvasNeighborsModal extends Modal {
  private suggestions: CanvasNeighborSuggestion[] = [];
  private selectedPaths: string[] = [];
  private canvasData: CanvasData | null = null;
  private readonly addedToCanvasPaths = new Set<string>();
  private batchUndoButton: HTMLButtonElement | null = null;
  private canvasUndoButton: HTMLButtonElement | null = null;
  private lastBatchInsert: {
    editor: Editor;
    beforeValue: string;
    afterValue: string;
  } | null = null;
  private lastCanvasWrite: {
    before: CanvasData;
    after: CanvasData;
    addedPaths: string[];
  } | null = null;

  constructor(app: App, private readonly context: CanvasSelectionContext) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.setTitle('Canvas neighbors');
    this.modalEl.addClass('claudian-plus-canvas-neighbors-modal');
    this.renderLoading();

    try {
      const canvas = await readCanvas(this.app.vault, this.context.canvasPath);
      this.canvasData = cloneCanvasData(canvas.data);
      const selectedIds = new Set(this.context.nodeIds);
      this.selectedPaths = [...new Set(
        canvas.data.nodes
          .filter(node => selectedIds.has(node.id))
          .flatMap(node => this.resolveNodePaths(node)),
      )];
      this.suggestions = buildCanvasNeighborSuggestions(
        this.selectedPaths,
        this.app.metadataCache.resolvedLinks ?? {},
      );
      this.render();
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.createEl('p', {
        cls: 'mod-error',
        text: `Could not inspect Canvas neighbors: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
    this.modalEl.removeClass('claudian-plus-canvas-neighbors-modal');
  }

  private renderLoading(): void {
    this.contentEl.empty();
    this.contentEl.createEl('p', {
      cls: 'claudian-plus-canvas-neighbors-loading',
      text: 'Reading selected canvas notes…',
    });
  }

  private render(): void {
    this.contentEl.empty();

    const description = this.contentEl.createDiv({ cls: 'claudian-plus-canvas-neighbors-description' });
    description.createDiv({
      text: this.selectedPaths.length > 0
        ? `Neighbors of ${this.selectedPaths.join(', ')}`
        : 'The selected nodes do not reference Markdown notes.',
    });
    description.createDiv({
      cls: 'claudian-plus-canvas-neighbors-hint',
      text: 'Suggestions come from Obsidian’s resolved one-hop link graph. Nothing is inserted automatically.',
    });

    if (this.suggestions.length === 0) {
      this.contentEl.createDiv({
        cls: 'claudian-plus-canvas-neighbors-empty',
        text: this.selectedPaths.length > 0
          ? 'No linked neighbors were found for this selection.'
          : 'Select file or linked-note nodes to explore nearby notes.',
      });
      return;
    }

    this.renderBatchActions();

    const list = this.contentEl.createDiv({ cls: 'claudian-plus-canvas-neighbors-list' });
    for (const [index, suggestion] of this.suggestions.entries()) {
      this.renderSuggestion(list, suggestion, index);
    }
  }

  private renderSuggestion(
    list: HTMLElement,
    suggestion: CanvasNeighborSuggestion,
    index: number,
  ): void {
    const item = list.createDiv({ cls: 'claudian-plus-canvas-neighbors-item' });
    const header = item.createDiv({ cls: 'claudian-plus-canvas-neighbors-item-header' });
    const openButton = header.createEl('button', {
      cls: 'claudian-plus-canvas-neighbors-source',
      attr: { type: 'button' },
    });
    setIcon(openButton, 'file-text');
    openButton.createSpan({ text: `[${index + 1}] ${suggestion.path}` });
    openButton.addEventListener('click', () => this.openNote(suggestion.path));

    item.createDiv({
      cls: 'claudian-plus-canvas-neighbors-meta',
      text: `${this.formatRelation(suggestion.relation)} · ${suggestion.linkCount} link${suggestion.linkCount === 1 ? '' : 's'}`,
    });
    item.createDiv({
      cls: 'claudian-plus-canvas-neighbors-via',
      text: `Via ${suggestion.via.join(', ')}`,
    });

    const actions = item.createDiv({ cls: 'claudian-plus-canvas-neighbors-actions' });
    const insertButton = actions.createEl('button', {
      cls: 'claudian-plus-canvas-neighbors-insert',
      text: 'Insert link',
      attr: { type: 'button' },
    });
    insertButton.addEventListener('click', () => this.insertLink(suggestion.path));

    const normalizedPath = this.normalizePath(suggestion.path);
    const alreadyAdded = this.addedToCanvasPaths.has(normalizedPath);
    const addButton = actions.createEl('button', {
      cls: 'claudian-plus-canvas-neighbors-add',
      text: alreadyAdded ? 'Added to canvas' : 'Add to canvas',
      attr: { type: 'button' },
    });
    addButton.disabled = alreadyAdded;
    addButton.addEventListener('click', () => {
      void this.addSuggestionsToCanvas([suggestion]);
    });
  }

  private renderBatchActions(): void {
    const actions = this.contentEl.createDiv({ cls: 'claudian-plus-canvas-neighbors-batch-actions' });
    const insertAllButton = actions.createEl('button', {
      cls: 'mod-cta claudian-plus-canvas-neighbors-insert-all',
      text: 'Insert all links',
      attr: { type: 'button' },
    });
    insertAllButton.addEventListener('click', () => {
      void this.insertAllLinks();
    });

    const addAllButton = actions.createEl('button', {
      cls: 'claudian-plus-canvas-neighbors-add-all',
      text: 'Add all to canvas',
      attr: { type: 'button' },
    });
    addAllButton.addEventListener('click', () => {
      void this.addSuggestionsToCanvas(this.suggestions);
    });

    this.batchUndoButton = actions.createEl('button', {
      cls: 'claudian-plus-canvas-neighbors-undo',
      text: 'Undo batch insert',
      attr: { type: 'button' },
    });
    this.batchUndoButton.toggleClass('claudian-plus-hidden', true);
    this.batchUndoButton.addEventListener('click', () => this.undoBatchInsert());

    this.canvasUndoButton = actions.createEl('button', {
      cls: 'claudian-plus-canvas-neighbors-undo-canvas',
      text: 'Undo canvas write',
      attr: { type: 'button' },
    });
    this.canvasUndoButton.toggleClass('claudian-plus-hidden', this.lastCanvasWrite === null);
    this.canvasUndoButton.addEventListener('click', () => {
      void this.undoCanvasWrite();
    });
  }

  private formatRelation(relation: CanvasNeighborSuggestion['relation']): string {
    if (relation === 'both') return 'Incoming + outgoing';
    return relation === 'outgoing' ? 'Selected note links to this' : 'This links to the selected note';
  }

  private openNote(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Could not open ${path}`);
      return;
    }
    void this.app.workspace.getLeaf().openFile(file);
  }

  private insertLink(path: string): void {
    const activeEditor = this.app.workspace.activeEditor;
    const editor = activeEditor?.editor;
    if (!editor) {
      new Notice('Open a Markdown note before inserting a neighbor link.');
      return;
    }
    const destination = this.app.vault.getAbstractFileByPath(path);
    if (!(destination instanceof TFile)) {
      new Notice(`Could not resolve ${path}`);
      return;
    }
    const linkText = this.app.metadataCache.fileToLinktext(
      destination,
      activeEditor.file?.path ?? '',
      true,
    );
    const link = `[[${linkText}]]`;
    const selectedText = editor.getSelection();
    if (selectedText.trim()) {
      editor.replaceSelection(`${selectedText} ${link}`);
    } else {
      editor.replaceRange(link, editor.getCursor());
    }
    this.clearBatchUndo();
    new Notice(`Inserted link: ${link}`);
  }

  /** Insert all currently visible candidates as one guarded editor operation. */
  private async insertAllLinks(): Promise<void> {
    const activeEditor = this.app.workspace.activeEditor;
    const editor = activeEditor?.editor;
    const sourcePath = activeEditor?.file?.path;
    if (!editor || !sourcePath) {
      new Notice('Open a Markdown note before inserting neighbor links.');
      return;
    }

    const existing = new Set(Object.keys(this.app.metadataCache.resolvedLinks?.[sourcePath] ?? {})
      .map(path => this.normalizePath(path)));
    const links = this.suggestions
      .map(suggestion => {
        const destination = this.app.vault.getAbstractFileByPath(suggestion.path);
        if (!(destination instanceof TFile)) return null;
        if (existing.has(this.normalizePath(destination.path))) return null;
        const linkText = this.app.metadataCache.fileToLinktext(destination, sourcePath, true);
        return `- [[${linkText}]]`;
      })
      .filter((link): link is string => link !== null);

    if (links.length === 0) {
      new Notice('No new neighbor links are available to insert.');
      return;
    }

    const beforeValue = editor.getValue();
    const confirmed = await confirm(
      this.app,
      `Insert ${links.length} neighbor link${links.length === 1 ? '' : 's'} into the active note?`,
      'Insert links',
    );
    if (!confirmed) return;
    if (editor.getValue() !== beforeValue) {
      new Notice('The note changed while waiting for confirmation; nothing was inserted.');
      return;
    }

    const cursor = editor.getCursor();
    const insertion = `${cursor.ch > 0 ? '\n' : ''}${links.join('\n')}\n`;
    editor.replaceRange(insertion, cursor, undefined, 'Claudian Plus: insert Canvas neighbor links');
    const afterValue = editor.getValue();
    this.lastBatchInsert = { editor, beforeValue, afterValue };
    this.batchUndoButton?.toggleClass('claudian-plus-hidden', false);
    new Notice(`Inserted ${links.length} neighbor link${links.length === 1 ? '' : 's'}.`);
  }

  /** Undo only when the editor still contains exactly the post-insert value. */
  private undoBatchInsert(): void {
    const batch = this.lastBatchInsert;
    if (!batch) return;
    if (batch.editor.getValue() !== batch.afterValue) {
      this.clearBatchUndo();
      new Notice('The note changed after batch insert; the operation was not undone.');
      return;
    }

    batch.editor.undo();
    if (batch.editor.getValue() === batch.beforeValue) {
      new Notice('Batch neighbor links undone.');
    } else {
      new Notice('Obsidian could not undo the batch insert safely.');
    }
    this.clearBatchUndo();
  }

  private clearBatchUndo(): void {
    this.lastBatchInsert = null;
    this.batchUndoButton?.toggleClass('claudian-plus-hidden', true);
  }

  private async addSuggestionsToCanvas(suggestions: CanvasNeighborSuggestion[]): Promise<void> {
    const current = this.canvasData;
    if (!current) {
      new Notice('Canvas data is not ready; reopen the neighbor panel and try again.');
      return;
    }
    const candidates = suggestions.filter(suggestion => (
      !this.addedToCanvasPaths.has(this.normalizePath(suggestion.path))
    ));
    if (candidates.length === 0) {
      new Notice('All selected neighbors are already on this canvas.');
      return;
    }

    let write: { plan: CanvasWritePlan; addedPaths: string[] };
    try {
      write = buildCanvasNeighborWritePlan(current, this.context.nodeIds, candidates);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      return;
    }
    if (write.plan.nodeOps.length === 0 && write.plan.edgeOps.length === 0) {
      new Notice('No new canvas nodes or edges are needed.');
      return;
    }

    const diff = diffCanvasWritePlan(current, write.plan);
    const confirmed = await confirm(this.app, diff, 'Write to canvas');
    if (!confirmed) return;

    try {
      const after = applyCanvasWritePlan(current, write.plan);
      await commitCanvasWrite(this.app.vault, this.context.canvasPath, write.plan, current);
      this.lastCanvasWrite = {
        before: cloneCanvasData(current),
        after: cloneCanvasData(after),
        addedPaths: write.addedPaths,
      };
      for (const path of write.addedPaths) this.addedToCanvasPaths.add(this.normalizePath(path));
      this.canvasData = cloneCanvasData(after);
      this.clearBatchUndo();
      new Notice(`Added ${write.addedPaths.length} neighbor${write.addedPaths.length === 1 ? '' : 's'} to canvas.`);
      this.render();
    } catch (error) {
      new Notice(`Canvas write failed safely: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async undoCanvasWrite(): Promise<void> {
    const write = this.lastCanvasWrite;
    if (!write) return;
    try {
      await undoLastCanvasWrite(this.app.vault, this.context.canvasPath, write.after);
      this.canvasData = cloneCanvasData(write.before);
      for (const path of write.addedPaths) this.addedToCanvasPaths.delete(this.normalizePath(path));
      this.lastCanvasWrite = null;
      new Notice('Canvas neighbor write undone.');
      this.render();
    } catch (error) {
      new Notice(`Canvas write was not undone: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private normalizePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  }

  private resolveNodePaths(node: CanvasNode): string[] {
    const paths: string[] = [];
    if (node.file) {
      const resolved = this.resolveLinkPath(node.file);
      if (resolved) paths.push(resolved);
    }
    if (node.text) {
      for (const match of node.text.matchAll(/\[\[([^\]]+)\]\]/gu)) {
        const linkpath = (match[1] ?? '').split('|', 1)[0].split('#', 1)[0].trim();
        const resolved = this.resolveLinkPath(linkpath);
        if (resolved) paths.push(resolved);
      }
    }
    return paths;
  }

  private resolveLinkPath(linkpath: string): string | null {
    const normalized = linkpath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!normalized) return null;
    const direct = this.app.vault.getAbstractFileByPath(normalized);
    if (direct instanceof TFile && direct.extension === 'md') return direct.path;
    const withExtension = normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`;
    const byPath = this.app.vault.getAbstractFileByPath(withExtension);
    if (byPath instanceof TFile && byPath.extension === 'md') return byPath.path;
    const resolved = this.app.metadataCache.getFirstLinkpathDest(normalized, this.context.canvasPath);
    return resolved?.extension === 'md' ? resolved.path : null;
  }
}

function cloneCanvasData(data: CanvasData): CanvasData {
  return {
    nodes: data.nodes.map(node => ({ ...node })),
    edges: data.edges.map(edge => ({ ...edge })),
  };
}
