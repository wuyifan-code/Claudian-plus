import type { CachedMetadata } from 'obsidian';

import {
  extractCanvasContext,
  extractDocumentContext,
  extractFocusContext,
  extractGraphContext,
} from '../../../../src/core/context/ambientExtractor';
import type { CanvasData } from '../../../../src/core/obsidian/canvas';

describe('ambientExtractor', () => {
  describe('extractDocumentContext', () => {
    it('extracts metadata, tags, and table of contents correctly', () => {
      const mockFile = {
        path: 'Notes/Architecture.md',
        basename: 'Architecture',
        extension: 'md',
      };

      const mockCache: CachedMetadata = {
        frontmatter: {
          type: 'rfc',
          status: 'draft',
          tags: ['arch', 'design'],
        },
        tags: [
          { tag: '#inline-tag', position: { start: { line: 10, col: 0, offset: 100 }, end: { line: 10, col: 11, offset: 111 } } },
        ],
        headings: [
          { heading: 'Overview', level: 1, position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 10, offset: 10 } } },
          { heading: 'Context Engine', level: 2, position: { start: { line: 15, col: 0, offset: 200 }, end: { line: 15, col: 16, offset: 216 } } },
          { heading: 'Pipeline', level: 3, position: { start: { line: 30, col: 0, offset: 400 }, end: { line: 30, col: 10, offset: 410 } } },
        ],
      };

      const content = '# Overview\n\nIntro text...\n\n## Context Engine\n\nSection text...\n';
      const docContext = extractDocumentContext(mockFile, mockCache, content);

      expect(docContext.path).toBe('Notes/Architecture.md');
      expect(docContext.basename).toBe('Architecture');
      expect(docContext.extension).toBe('md');
      expect(docContext.frontmatter).toEqual({ type: 'rfc', status: 'draft', tags: ['arch', 'design'] });
      expect(docContext.tags).toContain('#inline-tag');
      expect(docContext.tags).toContain('arch');
      expect(docContext.tags).toContain('design');
      expect(docContext.tableOfContents).toEqual([
        { heading: 'Overview', level: 1, line: 1 },
        { heading: 'Context Engine', level: 2, line: 16 },
        { heading: 'Pipeline', level: 3, line: 31 },
      ]);
    });
  });

  describe('extractFocusContext', () => {
    it('captures active selection when user selects text', () => {
      const mockEditor = {
        getSelection: () => 'const observer = new ActiveContextObserver();',
        getCursor: (which?: string) => {
          if (which === 'from') return { line: 5, ch: 0 };
          return { line: 5, ch: 46 };
        },
      };

      const focus = extractFocusContext(mockEditor as any);
      expect(focus).toEqual({
        type: 'selection',
        range: { startLine: 6, endLine: 6 },
        content: 'const observer = new ActiveContextObserver();',
      });
    });

    it('falls back to active section using TOC and cursor line when no selection', () => {
      const documentLines = [
        '# Document Root', // line 0
        'Root introduction...', // line 1
        '## Section A', // line 2
        'Content of section A line 1', // line 3
        'Content of section A line 2', // line 4
        '### Subsection A.1', // line 5
        'Content of A.1', // line 6
        '## Section B', // line 7
        'Content of section B', // line 8
      ];
      const fullContent = documentLines.join('\n');

      const headings = [
        { heading: 'Document Root', level: 1, position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 15, offset: 15 } } },
        { heading: 'Section A', level: 2, position: { start: { line: 2, col: 0, offset: 30 }, end: { line: 2, col: 12, offset: 42 } } },
        { heading: 'Subsection A.1', level: 3, position: { start: { line: 5, col: 0, offset: 80 }, end: { line: 5, col: 18, offset: 98 } } },
        { heading: 'Section B', level: 2, position: { start: { line: 7, col: 0, offset: 120 }, end: { line: 7, col: 12, offset: 132 } } },
      ];

      // Cursor is on line 3 (within Section A)
      const mockEditor = {
        getSelection: () => '',
        getCursor: () => ({ line: 3, ch: 5 }),
      };

      const focus = extractFocusContext(mockEditor as any, headings as any, fullContent);
      expect(focus).not.toBeNull();
      expect(focus?.type).toBe('section');
      expect(focus?.heading).toBe('Section A');
      expect(focus?.headingPath).toEqual(['# Document Root', '## Section A']);
      expect(focus?.range).toEqual({ startLine: 3, endLine: 7 }); // lines 2 to 6 (1-indexed: 3 to 7)
      expect(focus?.content).toBe(
        '## Section A\nContent of section A line 1\nContent of section A line 2\n### Subsection A.1\nContent of A.1'
      );
    });

    it('falls back to full document if no headings exist or cursor is at beginning', () => {
      const fullContent = 'Plain text note without headings.\nSecond line.';
      const mockEditor = {
        getSelection: () => '',
        getCursor: () => ({ line: 0, ch: 0 }),
      };

      const focus = extractFocusContext(mockEditor as any, [], fullContent);
      expect(focus).toEqual({
        type: 'full_document',
        content: fullContent,
      });
    });
  });

  describe('extractGraphContext', () => {
    it('extracts inlinks and outlinks from resolved links map', () => {
      const resolvedLinks = {
        'Notes/Architecture.md': {
          'Specs/Tokens.md': 1,
          'Specs/Engine.md': 2,
        },
        'Projects/Dashboard.md': {
          'Notes/Architecture.md': 1,
        },
        'Overview.md': {
          'Notes/Architecture.md': 3,
        },
      };

      const graph = extractGraphContext('Notes/Architecture.md', resolvedLinks);
      expect(graph.outlinks).toEqual(['Specs/Tokens.md', 'Specs/Engine.md']);
      expect(graph.inlinks).toEqual(['Projects/Dashboard.md', 'Overview.md']);
    });
  });

  describe('extractCanvasContext', () => {
    it('captures active node and its 1-hop connected neighbors', () => {
      const canvasData: CanvasData = {
        nodes: [
          { id: 'node-1', type: 'text', text: 'Main Architecture Idea', x: 0, y: 0, width: 200, height: 100 },
          { id: 'node-2', type: 'text', text: 'Database Layer', x: 250, y: 0, width: 200, height: 100 },
          { id: 'node-3', type: 'text', text: 'API Gateway', x: -250, y: 0, width: 200, height: 100 },
          { id: 'node-4', type: 'text', text: 'Unrelated Node', x: 500, y: 500, width: 200, height: 100 },
        ],
        edges: [
          { id: 'edge-1', fromNode: 'node-1', toNode: 'node-2', fromSide: 'right', toSide: 'left' },
          { id: 'edge-2', fromNode: 'node-3', toNode: 'node-1', fromSide: 'right', toSide: 'left' },
        ],
      };

      const canvasCtx = extractCanvasContext(canvasData, 'node-1');
      expect(canvasCtx).not.toBeNull();
      expect(canvasCtx?.activeNodeId).toBe('node-1');
      expect(canvasCtx?.neighborNodes).toEqual([
        { id: 'node-2', text: 'Database Layer', relation: 'points_to' },
        { id: 'node-3', text: 'API Gateway', relation: 'pointed_from' },
      ]);
    });
  });
});
