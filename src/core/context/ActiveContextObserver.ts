import type { App, EventRef } from 'obsidian';
import { MarkdownView } from 'obsidian';

import type { CanvasData } from '../obsidian/canvas';
import {
  extractCanvasContext,
  extractDocumentContext,
  extractFocusContext,
  extractGraphContext,
} from './ambientExtractor';
import type { AmbientContextSnapshot, ContextMode } from './types';

interface CanvasLeafLike {
  view?: {
    file?: {
      path: string;
      basename: string;
      extension: string;
    };
    canvas?: {
      data?: CanvasData;
      selection?: {
        values?: () => {
          next?: () => {
            value?: { id?: string; text?: string };
          };
        };
      };
    };
    data?: CanvasData;
    getViewType?: () => string;
  };
}

export interface ActiveContextObserverOptions {
  debounceMs?: number;
  onSnapshotChange?: (snapshot: AmbientContextSnapshot) => void;
  defaultMode?: ContextMode;
}

const DEFAULT_DEBOUNCE_MS = 150;
const POLL_INTERVAL_MS = 500;

/**
 * Observes the active Obsidian workspace (editor selection, section TOC fallback,
 * document metadata, and graph links) with a debounced pipeline.
 */
export class ActiveContextObserver {
  private readonly app: App;
  private readonly debounceMs: number;
  private mode: ContextMode;
  private snapshot: AmbientContextSnapshot;
  private listeners = new Set<(snapshot: AmbientContextSnapshot) => void>();
  private eventRefs: EventRef[] = [];
  private debounceTimer: number | null = null;
  private pollInterval: number | null = null;
  private isStarted = false;
  private isDisposed = false;

  constructor(app: App, options: ActiveContextObserverOptions = {}) {
    this.app = app;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.mode = options.defaultMode ?? 'auto';

    if (options.onSnapshotChange) {
      this.listeners.add(options.onSnapshotChange);
    }

    this.snapshot = {
      timestamp: Date.now(),
      mode: this.mode,
      document: null,
      focus: null,
      graph: null,
    };
  }

  start(): void {
    if (this.isStarted || this.isDisposed) return;
    this.isStarted = true;

    // Register Obsidian workspace and metadata events
    if (this.app.workspace?.on) {
      const leafRef = this.app.workspace.on('active-leaf-change', () => this.scheduleRefresh());
      if (leafRef) this.eventRefs.push(leafRef);

      const fileOpenRef = this.app.workspace.on('file-open', () => this.scheduleRefresh());
      if (fileOpenRef) this.eventRefs.push(fileOpenRef);

      const editorChangeRef = (this.app.workspace as unknown as { on?: (event: string, cb: () => void) => EventRef }).on?.(
        'editor-change',
        () => this.scheduleRefresh(),
      );
      if (editorChangeRef) this.eventRefs.push(editorChangeRef);
    }

    if (this.app.metadataCache?.on) {
      const metaRef = this.app.metadataCache.on('changed', () => this.scheduleRefresh());
      if (metaRef) this.eventRefs.push(metaRef);
    }

    // Polling interval for editor cursor/selection movements when active
    this.pollInterval = window.setInterval(() => {
      this.checkEditorChanges();
    }, POLL_INTERVAL_MS);

    this.scheduleRefresh();
  }

  stop(): void {
    this.isStarted = false;

    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.pollInterval !== null) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    for (const ref of this.eventRefs) {
      if (this.app.workspace?.offref) {
        this.app.workspace.offref(ref);
      }
      if (this.app.metadataCache?.offref) {
        this.app.metadataCache.offref(ref);
      }
    }
    this.eventRefs = [];
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.stop();
    this.listeners.clear();
  }

  getSnapshot(): AmbientContextSnapshot {
    return this.snapshot;
  }

  subscribe(callback: (snapshot: AmbientContextSnapshot) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  setMode(mode: ContextMode): void {
    if (this.mode === mode) return;
    this.mode = mode;

    if (mode === 'ignored') {
      this.snapshot = {
        timestamp: Date.now(),
        mode: 'ignored',
        document: null,
        focus: null,
        graph: null,
      };
      this.notifyListeners();
      return;
    }

    if (mode === 'auto') {
      this.snapshot = {
        ...this.snapshot,
        mode: 'auto',
      };
      this.scheduleRefresh();
      return;
    }

    if (mode === 'pinned') {
      this.snapshot = {
        ...this.snapshot,
        mode: 'pinned',
        timestamp: Date.now(),
      };
      this.notifyListeners();
    }
  }

  pin(): void {
    this.setMode('pinned');
  }

  unpin(): void {
    this.setMode('auto');
  }

  onSnapshotChange(listener: (snapshot: AmbientContextSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  refresh(): void {
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.isDisposed || this.mode === 'pinned' || this.mode === 'ignored') return;

    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.extractAndUpdateSnapshot();
    }, this.debounceMs);
  }

  private checkEditorChanges(): void {
    if (this.isDisposed || this.mode === 'pinned' || this.mode === 'ignored') return;
    if (typeof activeDocument !== 'undefined' && activeDocument.hidden) return;

    const view = this.app.workspace?.getActiveViewOfType?.(MarkdownView);
    if (!view?.editor) return;

    const currentSelection = view.editor.getSelection?.() ?? '';
    const lastFocusContent = this.snapshot.focus?.content;

    if (currentSelection.trim()) {
      if (this.snapshot.focus?.type !== 'selection' || lastFocusContent !== currentSelection) {
        this.scheduleRefresh();
      }
    } else if (this.snapshot.focus?.type === 'selection') {
      this.scheduleRefresh();
    }
  }

  private extractAndUpdateSnapshot(): void {
    if (this.isDisposed || this.mode === 'pinned' || this.mode === 'ignored') return;

    const markdownView = this.app.workspace?.getActiveViewOfType?.(MarkdownView);

    if (markdownView?.file && markdownView?.editor) {
      const file = markdownView.file;
      const fileCache = this.app.metadataCache?.getFileCache?.(file);
      const editor = markdownView.editor;
      const fullContent = typeof editor.getValue === 'function' ? editor.getValue() : '';

      const document = extractDocumentContext(
        {
          path: file.path,
          basename: file.basename,
          extension: file.extension,
        },
        fileCache,
        fullContent,
      );

      const focus = extractFocusContext(
        editor,
        fileCache?.headings,
        fullContent,
      );

      const graph = extractGraphContext(
        file.path,
        this.app.metadataCache?.resolvedLinks,
      );

      const nextSnapshot: AmbientContextSnapshot = {
        timestamp: Date.now(),
        mode: this.mode,
        document,
        focus,
        graph,
      };

      if (!this.isSnapshotEqual(this.snapshot, nextSnapshot)) {
        this.snapshot = nextSnapshot;
        this.notifyListeners();
      }
      return;
    }

    // Check if active view is Canvas
    const workspace = this.app.workspace as unknown as { activeLeaf?: CanvasLeafLike } | undefined;
    const activeLeaf = workspace?.activeLeaf;
    const activeView = activeLeaf?.view;
    if (activeView?.getViewType?.() === 'canvas' || activeView?.canvas) {
      const canvasFile = activeView.file;
      const canvasData = activeView.canvas?.data ?? activeView.data;
      const selectedNode = activeView.canvas?.selection?.values?.()?.next?.()?.value;
      const activeNodeId = selectedNode?.id;

      const canvasContext = extractCanvasContext(canvasData, activeNodeId);
      const graphContext = canvasFile
        ? extractGraphContext(canvasFile.path, this.app.metadataCache?.resolvedLinks)
        : { inlinks: [], outlinks: [] };

      if (canvasContext) {
        graphContext.canvasContext = canvasContext;
      }

      const nextSnapshot: AmbientContextSnapshot = {
        timestamp: Date.now(),
        mode: this.mode,
        document: canvasFile ? {
          path: canvasFile.path,
          basename: canvasFile.basename,
          extension: canvasFile.extension,
          frontmatter: null,
          tags: [],
          tableOfContents: [],
        } : null,
        focus: activeNodeId ? {
          type: 'canvas_node',
          content: selectedNode?.text || activeNodeId,
        } : null,
        graph: graphContext,
      };

      if (!this.isSnapshotEqual(this.snapshot, nextSnapshot)) {
        this.snapshot = nextSnapshot;
        this.notifyListeners();
      }
      return;
    }

    // No active markdown or canvas view
    if (this.snapshot.document !== null || this.snapshot.focus !== null || this.snapshot.graph !== null) {
      this.snapshot = {
        timestamp: Date.now(),
        mode: this.mode,
        document: null,
        focus: null,
        graph: null,
      };
      this.notifyListeners();
    }
  }

  private isSnapshotEqual(a: AmbientContextSnapshot, b: AmbientContextSnapshot): boolean {
    if (a.mode !== b.mode) return false;
    if (a.document?.path !== b.document?.path) return false;
    if (a.focus?.type !== b.focus?.type) return false;
    if (a.focus?.content !== b.focus?.content) return false;
    if (a.focus?.range?.startLine !== b.focus?.range?.startLine || a.focus?.range?.endLine !== b.focus?.range?.endLine) return false;
    return true;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // Safe listener notification
      }
    }
  }
}
