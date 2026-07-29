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
});
