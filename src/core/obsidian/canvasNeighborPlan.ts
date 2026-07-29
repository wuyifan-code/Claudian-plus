import type { CanvasData, CanvasWritePlan } from './canvas';
import type { CanvasNeighborSuggestion } from './canvasNeighbors';

export interface CanvasNeighborWritePlanResult {
  plan: CanvasWritePlan;
  addedPaths: string[];
}

export interface CanvasNeighborWritePlanOptions {
  /** Limits one explicit batch to keep the diff readable and bounded. */
  maxSuggestions?: number;
  /** Injectable for deterministic tests; production uses collision-safe IDs. */
  idFactory?: () => string;
}

/**
 * Converts graph suggestions into a safe Canvas node/edge patch.
 *
 * Existing file nodes are reused and only missing edges are added. New nodes
 * are placed to the right of the first selected node in a small grid so a
 * write never mutates the user's existing layout.
 */
export function buildCanvasNeighborWritePlan(
  current: CanvasData,
  selectedNodeIds: string[],
  suggestions: CanvasNeighborSuggestion[],
  options: CanvasNeighborWritePlanOptions = {},
): CanvasNeighborWritePlanResult {
  const anchor = current.nodes.find(node => selectedNodeIds.includes(node.id));
  if (!anchor) {
    throw new Error('The selected Canvas node no longer exists. Refresh the selection and try again.');
  }

  const idFactory = options.idFactory ?? (() => (
    `claudian-plus-neighbor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  ));
  const maxSuggestions = Math.max(1, Math.floor(options.maxSuggestions ?? 8));
  const nodeOps: CanvasWritePlan['nodeOps'] = [];
  const edgeOps: CanvasWritePlan['edgeOps'] = [];
  const addedPaths: string[] = [];
  const seenPaths = new Set<string>();
  const usedNodeIds = new Set(current.nodes.map(node => node.id));
  const workingNodes = [...current.nodes];
  let newNodeIndex = 0;

  for (const suggestion of suggestions) {
    if (addedPaths.length >= maxSuggestions) break;
    const path = suggestion.path.trim();
    const pathKey = normalizePath(path);
    if (!path || seenPaths.has(pathKey)) continue;
    seenPaths.add(pathKey);

    let target = workingNodes.find(node => node.type === 'file' && node.file && normalizePath(node.file) === pathKey);
    if (!target) {
      let id = idFactory();
      while (usedNodeIds.has(id)) id = idFactory();
      usedNodeIds.add(id);
      target = {
        id,
        type: 'file',
        x: anchor.x + anchor.width + 80 + (newNodeIndex % 2) * 340,
        y: anchor.y + Math.floor(newNodeIndex / 2) * 220,
        width: 300,
        height: 180,
        file: path,
      };
      newNodeIndex += 1;
      nodeOps.push({ action: 'add', node: target });
      workingNodes.push(target);
    }

    const edgeExists = current.edges.some(edge => (
      (edge.fromNode === anchor.id && edge.toNode === target.id)
      || (edge.fromNode === target.id && edge.toNode === anchor.id)
    )) || edgeOps.some(edge => (
      (edge.edge.fromNode === anchor.id && edge.edge.toNode === target.id)
      || (edge.edge.fromNode === target.id && edge.edge.toNode === anchor.id)
    ));
    if (!edgeExists && target.id !== anchor.id) {
      let edgeId = idFactory();
      while (current.edges.some(edge => edge.id === edgeId) || edgeOps.some(edge => edge.edge.id === edgeId)) {
        edgeId = idFactory();
      }
      edgeOps.push({
        action: 'add',
        edge: {
          id: edgeId,
          fromNode: anchor.id,
          toNode: target.id,
          label: 'Claudian Plus neighbor',
        },
      });
    }
    addedPaths.push(path);
  }

  return { plan: { nodeOps, edgeOps }, addedPaths };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}
