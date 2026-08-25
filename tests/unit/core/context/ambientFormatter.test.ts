import {
  formatAmbientContextXml,
  stripAmbientContext,
} from '../../../../src/core/context/ambientFormatter';
import type { AmbientContextSnapshot } from '../../../../src/core/context/types';

describe('ambientFormatter', () => {
  it('returns empty string if snapshot has no document or focus or mode is ignored', () => {
    const emptySnapshot: AmbientContextSnapshot = {
      timestamp: Date.now(),
      mode: 'auto',
      document: null,
      focus: null,
      graph: null,
    };
    expect(formatAmbientContextXml(emptySnapshot)).toBe('');

    const ignoredSnapshot: AmbientContextSnapshot = {
      ...emptySnapshot,
      mode: 'ignored',
    };
    expect(formatAmbientContextXml(ignoredSnapshot)).toBe('');
  });

  it('formats full markdown ambient context accurately with frontmatter, outline, focus, and links', () => {
    const snapshot: AmbientContextSnapshot = {
      timestamp: Date.now(),
      mode: 'auto',
      document: {
        path: 'Specs/Architecture.md',
        basename: 'Architecture',
        extension: 'md',
        frontmatter: { type: 'rfc', status: 'draft', version: 2 },
        tags: ['arch'],
        tableOfContents: [
          { heading: 'Overview', level: 1, line: 1 },
          { heading: 'Pain Points', level: 2, line: 12 },
          { heading: 'Context Engine', level: 2, line: 45 },
        ],
      },
      focus: {
        type: 'section',
        heading: 'Context Engine',
        headingPath: ['# Overview', '## Context Engine'],
        range: { startLine: 45, endLine: 89 },
        content: 'Section markdown text explaining the engine.',
      },
      graph: {
        inlinks: ['Projects/Dashboard.md'],
        outlinks: ['Specs/Tokens.md'],
      },
    };

    const xml = formatAmbientContextXml(snapshot);

    expect(xml).toContain('<ambient_context>');
    expect(xml).toContain('<active_document path="Specs/Architecture.md">');
    expect(xml).toContain('<frontmatter>');
    expect(xml).toContain('"type": "rfc"');
    expect(xml).toContain('<focus_scope type="section" heading="## Context Engine" range="L45-L89">');
    expect(xml).toContain('Section markdown text explaining the engine.');
    expect(xml).toContain('<document_outline>');
    expect(xml).toContain('- # Overview (L1)');
    expect(xml).toContain('- ## Context Engine (L45)');
    expect(xml).toContain('<linked_references inlinks="Projects/Dashboard.md" outlinks="Specs/Tokens.md" />');
    expect(xml).toContain('</active_document>');
    expect(xml).toContain('</ambient_context>');
  });

  it('handles canvas node focus scope with neighbors', () => {
    const snapshot: AmbientContextSnapshot = {
      timestamp: Date.now(),
      mode: 'auto',
      document: {
        path: 'Canvas/Design.canvas',
        basename: 'Design',
        extension: 'canvas',
        frontmatter: null,
        tags: [],
        tableOfContents: [],
      },
      focus: {
        type: 'canvas_node',
        content: 'Main Architecture Card',
      },
      graph: {
        inlinks: [],
        outlinks: [],
        canvasContext: {
          activeNodeId: 'node-1',
          neighborNodes: [
            { id: 'node-2', text: 'Database', relation: 'points_to' },
            { id: 'node-3', text: 'API Gateway', relation: 'pointed_from' },
          ],
        },
      },
    };

    const xml = formatAmbientContextXml(snapshot);
    expect(xml).toContain('<active_canvas path="Canvas/Design.canvas">');
    expect(xml).toContain('<focus_node id="node-1">');
    expect(xml).toContain('Main Architecture Card');
    expect(xml).toContain('- [points_to] node-2: Database');
    expect(xml).toContain('- [pointed_from] node-3: API Gateway');
  });

  it('truncates content when exceeding token budget limits', () => {
    const longContent = 'A'.repeat(50000);
    const snapshot: AmbientContextSnapshot = {
      timestamp: Date.now(),
      mode: 'auto',
      document: {
        path: 'Notes/Long.md',
        basename: 'Long',
        extension: 'md',
        frontmatter: null,
        tags: [],
        tableOfContents: [{ heading: 'Start', level: 1, line: 1 }],
      },
      focus: {
        type: 'full_document',
        content: longContent,
      },
      graph: { inlinks: [], outlinks: [] },
    };

    const xml = formatAmbientContextXml(snapshot, { maxContentChars: 1000 });
    expect(xml.length).toBeLessThan(5000);
    expect(xml).toContain('[Content truncated due to size limit]');
  });

  it('strips ambient context XML cleanly from prompts', () => {
    const prompt = 'User question here\n\n<ambient_context>\n<active_document path="Test.md">\n</active_document>\n</ambient_context>';
    const stripped = stripAmbientContext(prompt);
    expect(stripped).toBe('User question here');
  });
});
