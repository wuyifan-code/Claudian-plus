import type { Vault } from 'obsidian';

// ---------------------------------------------------------------------------
// Obsidian Canvas types — mirrors the *.canvas JSON format
// ---------------------------------------------------------------------------

export interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasReadResult {
  path: string;
  data: CanvasData;
}

export interface CanvasNodeOperation {
  action: 'add' | 'update' | 'delete';
  node: Partial<CanvasNode> & { id: string };
}

export interface CanvasEdgeOperation {
  action: 'add' | 'delete';
  edge: Partial<CanvasEdge> & { id: string; fromNode: string; toNode: string };
}

export interface CanvasWritePlan {
  nodeOps: CanvasNodeOperation[];
  edgeOps: CanvasEdgeOperation[];
}

/**
 * Reads an Obsidian Canvas file and returns its structured data.
 */
export async function readCanvas(
  vault: Vault,
  canvasPath: string,
): Promise<CanvasReadResult> {
  const file = vault.getFileByPath(canvasPath);
  if (!file) {
    throw new Error(`Canvas file not found: ${canvasPath}`);
  }
  if (file.extension !== 'canvas') {
    throw new Error(`File is not a canvas: ${canvasPath}`);
  }

  const raw = await vault.read(file);
  const data = JSON.parse(raw) as unknown;
  validateCanvasData(data, canvasPath);

  return { path: canvasPath, data };
}

/**
 * Applies a write plan to a Canvas file, returning the updated CanvasData.
 * The caller is responsible for persisting (write-back) and user confirmation.
 */
export function applyCanvasWritePlan(current: CanvasData, plan: CanvasWritePlan): CanvasData {
  const nodes = [...current.nodes];
  const edges = [...current.edges];

  for (const op of plan.nodeOps) {
    switch (op.action) {
      case 'add': {
        if (nodes.some(existing => existing.id === op.node.id)) {
          throw new Error(`Canvas node already exists: ${op.node.id}`);
        }
        const nodeType = op.node.type ?? 'text';
        if (!['text', 'file', 'link', 'group'].includes(nodeType)) {
          throw new Error(`Unsupported Canvas node type: ${String(nodeType)}`);
        }
        const newNode: CanvasNode = {
          id: op.node.id,
          type: nodeType,
          x: op.node.x ?? 0,
          y: op.node.y ?? 0,
          width: op.node.width ?? 300,
          height: op.node.height ?? 100,
          ...(op.node.text != null ? { text: op.node.text } : {}),
          ...(op.node.file != null ? { file: op.node.file } : {}),
          ...(op.node.subpath != null ? { subpath: op.node.subpath } : {}),
          ...(op.node.color != null ? { color: op.node.color } : {}),
        };
        nodes.push(newNode);
        break;
      }
      case 'update': {
        const idx = nodes.findIndex(n => n.id === op.node.id);
        if (idx === -1) {
          throw new Error(`Canvas node not found for update: ${op.node.id}`);
        }
        nodes[idx] = { ...nodes[idx], ...op.node };
        break;
      }
      case 'delete': {
        const idx = nodes.findIndex(n => n.id === op.node.id);
        if (idx === -1) {
          throw new Error(`Canvas node not found for delete: ${op.node.id}`);
        }
        nodes.splice(idx, 1);
        // Also remove edges referencing this node
        for (let i = edges.length - 1; i >= 0; i--) {
          if (edges[i].fromNode === op.node.id || edges[i].toNode === op.node.id) {
            edges.splice(i, 1);
          }
        }
        break;
      }
    }
  }

  for (const op of plan.edgeOps) {
    switch (op.action) {
      case 'add': {
        if (edges.some(existing => existing.id === op.edge.id)) {
          throw new Error(`Canvas edge already exists: ${op.edge.id}`);
        }
        if (!nodes.some(node => node.id === op.edge.fromNode)) {
          throw new Error(`Canvas edge source node not found: ${op.edge.fromNode}`);
        }
        if (!nodes.some(node => node.id === op.edge.toNode)) {
          throw new Error(`Canvas edge target node not found: ${op.edge.toNode}`);
        }
        edges.push({
          id: op.edge.id,
          fromNode: op.edge.fromNode,
          toNode: op.edge.toNode,
          fromSide: op.edge.fromSide,
          toSide: op.edge.toSide,
          label: op.edge.label,
        });
        break;
      }
      case 'delete': {
        const idx = edges.findIndex(e => e.id === op.edge.id);
        if (idx === -1) {
          throw new Error(`Canvas edge not found for delete: ${op.edge.id}`);
        }
        edges.splice(idx, 1);
        break;
      }
    }
  }

  return { nodes, edges };
}

/**
 * Serializes CanvasData back to the JSON string format Obsidian expects.
 */
export function serializeCanvasData(data: CanvasData): string {
  return JSON.stringify(data, null, '\t');
}

/**
 * Formats canvas data as a readable summary string for prompt injection.
 */
export function formatCanvasForPrompt(result: CanvasReadResult): string {
  const { path, data } = result;
  const lines: string[] = [
    `<obsidian_canvas path="${path}">`,
    `  Nodes (${data.nodes.length}):`,
  ];

  for (const node of data.nodes) {
    const textPreview = node.text
      ? ` "${truncate(node.text, 200)}"`
      : node.file
        ? ` → ${node.file}`
        : '';
    lines.push(`  - [${node.id}] ${node.type}${textPreview}`);
  }

  if (data.edges.length > 0) {
    lines.push(`  Edges (${data.edges.length}):`);
    for (const edge of data.edges) {
      const label = edge.label ? ` (${edge.label})` : '';
      lines.push(`  - ${edge.fromNode} → ${edge.toNode}${label}`);
    }
  }

  lines.push('</obsidian_canvas>');
  return lines.join('\n');
}

/**
 * Generates a compact diff preview for a Canvas write plan.
 */
export function diffCanvasWritePlan(
  current: CanvasData,
  plan: CanvasWritePlan,
): string {
  const lines: string[] = ['Proposed Canvas changes:\n'];

  for (const op of plan.nodeOps) {
    const label = `  [${op.action}] node ${op.node.id}`;
    switch (op.action) {
      case 'add':
        lines.push(`${label}: new ${op.node.type ?? 'text'} node`);
        if (op.node.text) lines.push(`      text: ${truncate(op.node.text, 80)}`);
        if (op.node.file) lines.push(`      file: ${op.node.file}`);
        break;
      case 'update': {
        const existing = current.nodes.find(n => n.id === op.node.id);
        if (existing) {
          const changes: string[] = [];
          for (const [key, value] of Object.entries(op.node)) {
            if (key !== 'id') changes.push(`${key}: ${JSON.stringify(value)}`);
          }
          lines.push(`${label}: ${changes.join(', ')}`);
        }
        break;
      }
      case 'delete':
        lines.push(`${label}`);
        break;
    }
  }

  for (const op of plan.edgeOps) {
    const label = `  [${op.action}] edge ${op.edge.id} (${op.edge.fromNode} → ${op.edge.toNode})`;
    lines.push(label);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateCanvasData(data: unknown, path: string): asserts data is CanvasData {
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid canvas file: ${path}`);
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.nodes)) {
    throw new Error(`Canvas "${path}" has no nodes array`);
  }
  if (!Array.isArray(obj.edges)) {
    throw new Error(`Canvas "${path}" has no edges array`);
  }
  // Validate each node has required fields
  for (let i = 0; i < obj.nodes.length; i++) {
    const node = obj.nodes[i] as Record<string, unknown>;
    if (typeof node.id !== 'string') {
      throw new Error(`Canvas "${path}" node[${i}] missing valid id`);
    }
    if (typeof node.type !== 'string') {
      throw new Error(`Canvas "${path}" node[${i}] missing valid type`);
    }
  }
  // Validate each edge has required fields
  for (let i = 0; i < obj.edges.length; i++) {
    const edge = obj.edges[i] as Record<string, unknown>;
    if (typeof edge.id !== 'string') {
      throw new Error(`Canvas "${path}" edge[${i}] missing valid id`);
    }
    if (typeof edge.fromNode !== 'string' || typeof edge.toNode !== 'string') {
      throw new Error(`Canvas "${path}" edge[${i}] missing valid fromNode/toNode`);
    }
  }
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + '…';
}
