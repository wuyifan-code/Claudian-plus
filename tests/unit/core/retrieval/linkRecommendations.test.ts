import {
  buildLinkRecommendationQuery,
  filterLinkRecommendationCandidates,
} from '@/core/retrieval/linkRecommendations';

describe('buildLinkRecommendationQuery', () => {
  it('prefers the selected prose over the whole note', () => {
    expect(buildLinkRecommendationQuery(
      '# Long note\nabout unrelated content',
      '  focused paragraph about graph retrieval  ',
    )).toBe('focused paragraph about graph retrieval');
  });

  it('removes frontmatter and fenced code from fallback note content', () => {
    expect(buildLinkRecommendationQuery([
      '---',
      'tags: [draft]',
      '---',
      '',
      'Useful knowledge graph paragraph.',
      '',
      '```ts',
      'const noisy = true;',
      '```',
    ].join('\n'))).toBe('Useful knowledge graph paragraph.');
  });

  it('bounds long recommendation queries', () => {
    const result = buildLinkRecommendationQuery('x'.repeat(5_000), '', 320);
    expect(result).toHaveLength(320);
  });
});

describe('filterLinkRecommendationCandidates', () => {
  it('removes self-links, existing links, duplicates, and weak matches while preserving reasons', () => {
    const results = filterLinkRecommendationCandidates(
      'notes/current.md',
      [
        { path: 'notes/current.md', heading: '', excerpt: '', score: 1, matchedTerms: ['x'], modifiedAt: 1 },
        { path: 'notes/already.md', heading: '', excerpt: '', score: 1, matchedTerms: ['x'], modifiedAt: 1 },
        { path: 'notes/strong.md', heading: '', excerpt: '', score: 0.8, matchedTerms: ['graph'], modifiedAt: 1 },
        { path: 'notes/strong.md', heading: '', excerpt: '', score: 0.7, matchedTerms: ['graph'], modifiedAt: 1 },
        { path: 'notes/weak.md', heading: '', excerpt: '', score: 0.01, matchedTerms: [], modifiedAt: 1 },
        { path: 'notes/semantic.md', heading: '', excerpt: '', score: 0.3, matchedTerms: [], semanticScore: 0.82, modifiedAt: 1 },
      ],
      { 'notes/already.md': 1 },
      { limit: 5 },
    );

    expect(results.map(result => result.path)).toEqual(['notes/strong.md', 'notes/semantic.md']);
    expect(results[0].recommendationReason).toBe('Shares terms: graph');
    expect(results[1].recommendationReason).toBe('Semantic similarity 82%');
  });
});
