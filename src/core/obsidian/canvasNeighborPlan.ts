import type { CanvasData, CanvasWritePlan } from './canvas';
import type { CanvasNeighborSuggestion } from './canvasNeighbors';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasNeighborWritePlanResult {
  plan: CanvasWritePlan;
  addedPaths: string[];
}

export interface CanvasNeighborWritePlanOptions {
  /** Limits one explicit batch to keep the diff readable and bounded. */
  maxSuggestions?: number;
  /** Injectable for deterministic tests; production uses collision-safe IDs. */
  idFactory?: () => string;
  /** Enable AABB collision avoidance and radial slot probing for new cards. */
  avoidCollisions?: boolean;
}

/**
 * Checks whether two Axis-Aligned Bounding Boxes overlap, including an optional safety margin.
 */
export function checkAABBCollision(a: Box, b: Box, margin = 20): boolean {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width + margin > b.x &&
    a.y < b.y + b.height + margin &&
    a.y + a.height + margin > b.y
  );
}

/**
 * Probes non-colliding slots around the anchor node using radial and grid probing.
 */
export function findNonCollidingSlot(
  anchor: Box,
  existingNodes: Box[],
  width = 300,
  height = 180,
  margin = 20,
): { x: number; y: number } {
  const defaultX = anchor.x + anchor.width + 80;
  const defaultY = anchor.y;

  // First probe standard right-side grid positions
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 5; col++) {
      const candidate: Box = {
        x: defaultX + col * (width + 40),
        y: defaultY + row * (height + 40),
        width,
        height,
      };
      const collides = existingNodes.some(node => checkAABBCollision(candidate, node, margin));
      if (!collides) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  // Radial spiral probing around anchor center if right side is congested
  const centerX = anchor.x + anchor.width / 2;
  const centerY = anchor.y + anchor.height / 2;
  const baseRadius = Math.max(anchor.width, anchor.height) + Math.max(width, height) / 2 + 40;

  for (let ring = 1; ring <= 15; ring++) {
    const radius = baseRadius * ring * 0.7;
    const steps = 8 * ring;
    for (let step = 0; step < steps; step++) {
      const angle = (step / steps) * 2 * Math.PI;
      const candidate: Box = {
        x: Math.round(centerX + Math.cos(angle) * radius - width / 2),
        y: Math.round(centerY + Math.sin(angle) * radius - height / 2),
        width,
        height,
      };
      const collides = existingNodes.some(node => checkAABBCollision(candidate, node, margin));
      if (!collides) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  return { x: defaultX, y: defaultY };
}

/**
 * Converts graph suggestions into a safe Canvas node/edge patch.
 *
 * Existing file nodes are reused and only missing edges are added.
 * When avoidCollisions is true, places new nodes using AABB collision avoidance
 * and radial slot probing so newly placed cards do not overlap existing nodes.
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

      if (options.avoidCollisions) {
        const slot = findNonCollidingSlot(anchor, workingNodes, 300, 180);
        target = {
          id,
          type: 'file',
          x: slot.x,
          y: slot.y,
          width: 300,
          height: 180,
          file: path,
        };
      } else {
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
      }

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
