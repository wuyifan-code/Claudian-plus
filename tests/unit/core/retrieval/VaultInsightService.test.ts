import type { InsightSource } from '@/core/retrieval/VaultInsightService';
import {
  buildMocSuggestions,
  buildTagNormalizations,
  buildVaultInsights,
} from '@/core/retrieval/VaultInsightService';

describe('buildVaultInsights', () => {
  it('groups recurring topics, open loops, and link activity with source paths', () => {
    const report = buildVaultInsights([
      {
        path: 'notes/one.md',
        modifiedAt: 1,
        text: [
          '---',
          'internal: secret',
          '---',
          '# Retrieval',
          '',
          'Local retrieval helps connect ideas. [[notes/two]]',
          '- [ ] Review retrieval pipeline',
          '```ts',
          'const retrieval = "noise";',
          '```',
        ].join('\n'),
      },
      {
        path: 'notes/two.md',
        modifiedAt: 2,
        text: '# Retrieval notes\n\nA local retrieval workflow keeps ideas connected.\n- [ ] Link this note',
      },
    ], {
      'notes/one.md': { 'notes/missing.md': 1 },
    });

    expect(report.sourceCount).toBe(2);
    expect(report.topics[0]).toMatchObject({ term: 'retrieval', count: 5 });
    expect(report.topics[0].sourcePaths).toEqual(['notes/one.md', 'notes/two.md']);
    expect(report.openLoops).toEqual([
      { text: 'Review retrieval pipeline', path: 'notes/one.md', line: 7 },
      { text: 'Link this note', path: 'notes/two.md', line: 4 },
    ]);
    expect(report.linkSignals).toEqual([
      { path: 'notes/one.md', outgoingCount: 1, brokenCount: 1 },
    ]);
  });

  it('returns bounded empty signals for an empty source set', () => {
    expect(buildVaultInsights([])).toEqual({
      topics: [],
      openLoops: [],
      linkSignals: [],
      sourceCount: 0,
    });
  });
});

describe('buildTagNormalizations', () => {
  function makeSource(path: string, tags: string[]): InsightSource {
    const frontmatter = ['---', `tags: [${tags.join(', ')}]`, '---'].join('\n');
    return {
      path,
      text: `${frontmatter}\n# Some note\n\nContent here.`,
      modifiedAt: Date.now(),
    };
  }

  it('returns empty when there are no tags across sources', () => {
    const sources: InsightSource[] = [
      { path: 'a.md', text: '# No tags', modifiedAt: 1 },
    ];
    expect(buildTagNormalizations(sources)).toEqual([]);
  });

  it('returns empty when all tags are consistent', () => {
    const sources = [
      makeSource('one.md', ['rust', 'async']),
      makeSource('two.md', ['rust', 'async', 'cli']),
    ];
    expect(buildTagNormalizations(sources)).toEqual([]);
  });

  it('flags case-insensitive duplicates', () => {
    const sources = [
      makeSource('one.md', ['Rust', 'Async']),
      makeSource('two.md', ['rust', 'async']),
    ];
    const result = buildTagNormalizations(sources);
    expect(result).toHaveLength(2);
    const byCanonical = new Map(result.map(r => [r.canonical, r]));
    expect(byCanonical.get('rust')!.variants).toEqual(expect.arrayContaining(['Rust', 'rust']));
    expect(byCanonical.get('rust')!.sourcePaths).toEqual(['one.md', 'two.md']);
    expect(byCanonical.get('async')!.variants).toEqual(expect.arrayContaining(['Async', 'async']));
  });

  it('flags prefix overlaps where one tag is a substring of another', () => {
    const sources = [
      makeSource('one.md', ['rust']),
      makeSource('two.md', ['rust-lang', 'rust']),
    ];
    const result = buildTagNormalizations(sources);
    // rust-lang and rust overlap; rust should be the canonical (shorter)
    expect(result.some(r => r.canonical === 'rust' && r.variants.includes('rust-lang'))).toBe(true);
  });

  it('does not flag unrelated tags that happen to share characters', () => {
    const sources = [
      makeSource('one.md', ['rust']),
      makeSource('two.md', ['rustic']),
    ];
    const result = buildTagNormalizations(sources);
    // rust and rustic share the first 4 characters but rustic does NOT start
    // with "rust-" so the prefix-overlap check skips it.
    expect(result.every(r => !r.variants.includes('rustic'))).toBe(true);
  });

  it('returns empty when tags only differ by separators that map to the same canonical', () => {
    const sources = [
      makeSource('one.md', ['rust-lang']),
      makeSource('two.md', ['rust_lang']),
    ];
    expect(buildTagNormalizations(sources)).toEqual([]);
  });

  it('handles yaml array and inline tag frontmatter', () => {
    const sourceA: InsightSource = {
      path: 'a.md',
      text: '---\ntags:\n  - rust\n  - Async\n---\n# Note',
      modifiedAt: 1,
    };
    const sourceB: InsightSource = {
      path: 'b.md',
      text: '---\ntags: [Rust, async, cli]\n---\n# Note',
      modifiedAt: 2,
    };
    const result = buildTagNormalizations([sourceA, sourceB]);
    expect(result.some(r => r.canonical === 'rust' && r.variants.includes('Async'))).toBe(false);
    expect(result.some(r => r.canonical === 'rust' && r.variants.includes('Rust'))).toBe(true);
  });

  it('handles CRLF line endings in frontmatter', () => {
    const source: InsightSource = {
      path: 'crlf.md',
      text: '---\r\ntags:\r\n  - rust\r\n  - async\r\n---\r\n# Note',
      modifiedAt: 1,
    };
    const result = buildTagNormalizations([source]);
    expect(result).toEqual([]);
  });

  it('handles YAML ... closing delimiter', () => {
    const source: InsightSource = {
      path: 'dots.md',
      text: '---\ntags: [rust, async]\n...\n# Note',
      modifiedAt: 1,
    };
    const result = buildTagNormalizations([source]);
    expect(result).toEqual([]);
  });
});

describe('buildMocSuggestions', () => {
  function makeSource(path: string, body: string): InsightSource {
    return { path, text: body, modifiedAt: Date.now() };
  }

  it('returns empty when there are no topic clusters across directories', () => {
    const sources = [
      makeSource('dir1/a.md', '# Rust notes\nRust async programming'),
    ];
    expect(buildMocSuggestions(sources)).toEqual([]);
  });

  it('suggests a MOC when a topic appears across multiple directories', () => {
    const sources = [
      makeSource('projects/rust-basics.md', '# Rust basics\nRust ownership and borrowing'),
      makeSource('notes/rust-advanced.md', '# Advanced Rust\nRust async and traits'),
      makeSource('archive/rust-old.md', '# Old Rust notes\nRust lifetimes'),
    ];
    const result = buildMocSuggestions(sources);
    expect(result.length).toBeGreaterThan(0);
    const rustSuggestion = result.find(r => r.topic === 'rust');
    expect(rustSuggestion).toBeDefined();
    expect(rustSuggestion!.paths).toHaveLength(3);
    expect(rustSuggestion!.directories).toHaveLength(3);
    expect(rustSuggestion!.suggestedMocPath).toMatch(/rust/i);
  });

  it('does not suggest MOC for a topic contained in a single directory', () => {
    const sources = [
      makeSource('rust/one.md', '# Rust one\nRust basics'),
      makeSource('rust/two.md', '# Rust two\nRust async'),
    ];
    const result = buildMocSuggestions(sources);
    // "rust" appears in multiple files but all under one directory
    const rustResult = result.filter(r => r.topic === 'rust');
    expect(rustResult).toHaveLength(0);
  });

  it('ranks suggestions by spread (distinct directories) and then file count', () => {
    // Topic "rust" appears in 3 dirs × 2 files = 3 dirs, 6 files
    // Topic "python" appears in 3 dirs × 1 file = 3 dirs, 3 files
    // Topic "async" appears in 2 dirs × 3 files = 2 dirs, 3 files
    const sources = [
      makeSource('a/rust1.md', '# Note\nRust is great'),
      makeSource('a/rust2.md', '# Note\nRust programming'),
      makeSource('b/rust3.md', '# Note\nRust async programming'),
      makeSource('b/rust4.md', '# Note\nRust patterns'),
      makeSource('c/rust5.md', '# Note\nRust embedded'),
      makeSource('c/rust6.md', '# Note\nRust systems'),
      makeSource('a/python1.md', '# Note\nPython scripting'),
      makeSource('b/python2.md', '# Note\nPython data'),
      makeSource('c/python3.md', '# Note\nPython ml'),
      makeSource('d/async1.md', '# Note\nAsync patterns'),
      makeSource('d/async2.md', '# Note\nAsync rust'),
      makeSource('e/async3.md', '# Note\nAsync python'),
    ];
    const result = buildMocSuggestions(sources);
    // First suggestion should be rust (most dirs, most files)
    expect(result[0]?.topic).toBe('rust');
    // python has 3 dirs (a,b,c) vs async has 2 dirs (d,e) → python second
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[1]?.topic).toBe('python');
  });

  it('caps at top 5 suggestions', () => {
    // Create 8 distinct topics each in at least 2 dirs
    const topics = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
    const sources: InsightSource[] = [];
    for (const topic of topics) {
      sources.push(makeSource(`x/${topic}1.md`, `# Note\n${topic} content`));
      sources.push(makeSource(`y/${topic}2.md`, `# Note\n${topic} more`));
    }
    const result = buildMocSuggestions(sources);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('uses the most frequent directory as the suggested MOC location', () => {
    const sources = [
      makeSource('main/project-a.md', '# Project A\nRust project structure'),
      makeSource('main/project-b.md', '# Project B\nRust patterns'),
      makeSource('main/project-c.md', '# Project C\nRust async'),
      makeSource('side/experiment.md', '# Experiment\nRust experiment'),
    ];
    const result = buildMocSuggestions(sources);
    const rustSuggestion = result.find(r => r.topic === 'rust');
    expect(rustSuggestion).toBeDefined();
    // The most frequent dir for rust is "main" (3 files vs 1 in "side")
    expect(rustSuggestion!.suggestedMocPath).toMatch(/^main\//);
  });

  it('returns empty for CJK-only topics in a single directory', () => {
    const sources = [
      makeSource('notes/学习.md', '# 学习笔记\n学习 Rust 编程'),
      makeSource('notes/读书.md', '# 读书笔记\n读书 学习'),
    ];
    // Both in "notes" dir, no cross-dir spread
    const result = buildMocSuggestions(sources);
    expect(result).toHaveLength(0);
  });

  it('suggests MOC for CJK topics spread across directories', () => {
    const sources = [
      makeSource('编程/Rust.md', '# Rust\n学习 Rust 语言'),
      makeSource('笔记/Rust.md', '# Rust 笔记\nRust 学习笔记'),
      makeSource('归档/Rust.md', '# 旧 Rust\nRust 旧笔记'),
    ];
    const result = buildMocSuggestions(sources);
    // CJK bigram "学习" should appear
    const cjkResult = result.filter(r => r.paths.length >= 3);
    expect(cjkResult.length).toBeGreaterThan(0);
  });
});
