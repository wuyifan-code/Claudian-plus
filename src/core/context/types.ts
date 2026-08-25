export type ContextMode = 'auto' | 'pinned' | 'ignored';

export type FocusScopeType = 'selection' | 'section' | 'full_document' | 'canvas_node';

export interface EditorLike {
  getValue?: () => string;
  getSelection?: () => string;
  getCursor?: (side?: 'anchor' | 'from' | 'to' | 'head') => { line: number; ch: number };
  getLine?: (line: number) => string;
  lineCount?: () => number;
}

export interface AmbientHeading {
  heading: string;
  level: number;
  line: number; // 1-indexed line number
}

export interface AmbientDocumentContext {
  path: string;
  basename: string;
  extension: string;
  frontmatter: Record<string, unknown> | null;
  tags: string[];
  tableOfContents: AmbientHeading[];
  wordCount?: number;
  lineCount?: number;
}

export interface AmbientFocusContext {
  type: FocusScopeType;
  range?: { startLine: number; endLine: number }; // 1-indexed line numbers
  headingPath?: string[]; // e.g. ["# Architecture", "## Context Engine"]
  heading?: string;
  content: string;
}

export interface CanvasNeighborNode {
  id: string;
  text: string;
  relation: string;
}

export interface CanvasNodeContext {
  activeNodeId: string;
  neighborNodes: CanvasNeighborNode[];
}

export interface AmbientGraphContext {
  inlinks: string[];
  outlinks: string[];
  canvasContext?: CanvasNodeContext;
}

export interface AmbientContextSnapshot {
  timestamp: number;
  mode: ContextMode;
  document: AmbientDocumentContext | null;
  focus: AmbientFocusContext | null;
  graph: AmbientGraphContext | null;
}
