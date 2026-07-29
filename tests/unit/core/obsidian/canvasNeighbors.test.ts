import { buildCanvasNeighborSuggestions } from '@/core/obsidian/canvasNeighbors';

describe('buildCanvasNeighborSuggestions', () => {
  it('merges incoming and outgoing neighbors and excludes the selection', () => {
    const suggestions = buildCanvasNeighborSuggestions(
      ['notes/A.md', 'notes/B.md'],
      {
        'notes/A.md': { 'notes/B.md': 1, 'notes/C.md': 2 },
        'notes/C.md': { 'notes/A.md': 3, 'notes/B.md': 1 },
        'notes/D.md': { 'notes/A.md': 2 },
      },
    );

    expect(suggestions).toEqual([
      {
        path: 'notes/C.md',
        relation: 'both',
        linkCount: 6,
        via: ['notes/A.md', 'notes/B.md'],
      },
      {
        path: 'notes/D.md',
        relation: 'incoming',
        linkCount: 2,
        via: ['notes/A.md'],
      },
    ]);
  });

  it('ignores invalid counts and applies a deterministic limit', () => {
    const suggestions = buildCanvasNeighborSuggestions(
      ['A.md'],
      {
        'A.md': { 'z.md': 1, 'b.md': '2' as unknown as number, 'bad.md': 0 },
      },
      1,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].path).toBe('b.md');
    expect(suggestions[0].linkCount).toBe(2);
  });
});
