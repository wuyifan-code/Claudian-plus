import { buildCanvasNeighborWritePlan } from '@/core/obsidian/canvasNeighborPlan';

describe('buildCanvasNeighborWritePlan', () => {
  const anchor = {
    id: 'anchor',
    type: 'text' as const,
    x: 100,
    y: 100,
    width: 240,
    height: 140,
    text: 'Selected idea',
  };

  it('reuses existing file nodes and adds only missing nodes and edges', () => {
    const result = buildCanvasNeighborWritePlan(
      {
        nodes: [anchor, {
          id: 'existing',
          type: 'file',
          x: 500,
          y: 100,
          width: 300,
          height: 180,
          file: 'notes/existing.md',
        }],
        edges: [{ id: 'edge-existing', fromNode: 'anchor', toNode: 'existing' }],
      },
      ['anchor'],
      [
        { path: 'notes/existing.md', relation: 'outgoing', linkCount: 1, via: ['source.md'] },
        { path: 'notes/new.md', relation: 'incoming', linkCount: 1, via: ['source.md'] },
        { path: 'notes/new.md', relation: 'incoming', linkCount: 2, via: ['source.md'] },
      ],
      { idFactory: () => 'new-node' },
    );

    expect(result.addedPaths).toEqual(['notes/existing.md', 'notes/new.md']);
    expect(result.plan.nodeOps).toHaveLength(1);
    expect(result.plan.nodeOps[0].node).toMatchObject({
      id: 'new-node',
      type: 'file',
      file: 'notes/new.md',
      x: 420,
      y: 100,
    });
    expect(result.plan.edgeOps).toHaveLength(1);
    expect(result.plan.edgeOps[0].edge).toMatchObject({
      fromNode: 'anchor',
      toNode: 'new-node',
      label: 'Claudian Plus neighbor',
    });
  });

  it('rejects a stale selection instead of writing to an unrelated node', () => {
    expect(() => buildCanvasNeighborWritePlan(
      { nodes: [anchor], edges: [] },
      ['missing'],
      [{ path: 'notes/new.md', relation: 'outgoing', linkCount: 1, via: [] }],
    )).toThrow('selected Canvas node no longer exists');
  });

  it('avoids bounding-box collision with existing nodes when avoidCollisions is true', () => {
    const obstacleNode = {
      id: 'obstacle',
      type: 'file' as const,
      x: 420,
      y: 100,
      width: 300,
      height: 180,
      file: 'notes/obstacle.md',
    };

    const result = buildCanvasNeighborWritePlan(
      {
        nodes: [anchor, obstacleNode],
        edges: [],
      },
      ['anchor'],
      [{ path: 'notes/new.md', relation: 'incoming', linkCount: 1, via: ['source.md'] }],
      {
        idFactory: () => 'anti-collision-node',
        avoidCollisions: true,
      },
    );

    expect(result.plan.nodeOps).toHaveLength(1);
    const placedNode = result.plan.nodeOps[0].node as any;
    expect(placedNode.id).toBe('anti-collision-node');
    // Ensure the placed node does not overlap the obstacle
    const overlapsObstacle =
      placedNode.x < obstacleNode.x + obstacleNode.width &&
      placedNode.x + placedNode.width > obstacleNode.x &&
      placedNode.y < obstacleNode.y + obstacleNode.height &&
      placedNode.y + placedNode.height > obstacleNode.y;
    expect(overlapsObstacle).toBe(false);
  });

  it('probes radially when right-side positions are fully congested', () => {
    // Fill the right-side grid with obstacles
    const obstacles = [];
    const defaultX = anchor.x + anchor.width + 80;
    const defaultY = anchor.y;
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 5; col++) {
        obstacles.push({
          id: `obs-${row}-${col}`,
          type: 'file' as const,
          x: defaultX + col * 340,
          y: defaultY + row * 220,
          width: 300,
          height: 180,
          file: `notes/obs-${row}-${col}.md`,
        });
      }
    }

    const result = buildCanvasNeighborWritePlan(
      {
        nodes: [anchor, ...obstacles],
        edges: [],
      },
      ['anchor'],
      [{ path: 'notes/radial.md', relation: 'incoming', linkCount: 1, via: ['source.md'] }],
      {
        idFactory: () => 'radial-node',
        avoidCollisions: true,
      },
    );

    expect(result.plan.nodeOps).toHaveLength(1);
    const placedNode = result.plan.nodeOps[0].node as any;
    expect(placedNode.id).toBe('radial-node');

    // Placed node must not overlap any obstacle
    for (const obs of obstacles) {
      const overlaps =
        placedNode.x < obs.x + obs.width &&
        placedNode.x + placedNode.width > obs.x &&
        placedNode.y < obs.y + obs.height &&
        placedNode.y + placedNode.height > obs.y;
      expect(overlaps).toBe(false);
    }
  });
});
