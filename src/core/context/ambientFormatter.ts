import type { AmbientContextSnapshot } from './types';

export interface AmbientFormatBudgetOptions {
  maxContentChars?: number;
  maxOutlineEntries?: number;
  maxLinks?: number;
}

const DEFAULT_MAX_CONTENT_CHARS = 32_000; // ~8,000 tokens
const DEFAULT_MAX_OUTLINE_ENTRIES = 50;
const DEFAULT_MAX_LINKS = 25;

export const AMBIENT_CONTEXT_TAG = 'ambient_context';
export const AMBIENT_CONTEXT_REGEX = /<ambient_context>[\s\S]*?<\/ambient_context>/g;

/**
 * Formats an immutable AmbientContextSnapshot into structural XML suitable for
 * system prompt injection or ephemeral turn execution.
 */
export function formatAmbientContextXml(
  snapshot: AmbientContextSnapshot | null | undefined,
  options: AmbientFormatBudgetOptions = {},
): string {
  if (!snapshot || snapshot.mode === 'ignored') return '';
  if (!snapshot.document && !snapshot.focus && !snapshot.graph) return '';

  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const maxOutlineEntries = options.maxOutlineEntries ?? DEFAULT_MAX_OUTLINE_ENTRIES;
  const maxLinks = options.maxLinks ?? DEFAULT_MAX_LINKS;

  const isCanvas = snapshot.document?.extension === 'canvas' || snapshot.focus?.type === 'canvas_node';

  if (isCanvas) {
    return formatCanvasAmbientContext(snapshot, maxContentChars, maxLinks);
  }

  return formatMarkdownAmbientContext(snapshot, maxContentChars, maxOutlineEntries, maxLinks);
}

function formatMarkdownAmbientContext(
  snapshot: AmbientContextSnapshot,
  maxContentChars: number,
  maxOutlineEntries: number,
  maxLinks: number,
): string {
  const parts: string[] = [];
  const doc = snapshot.document;
  const focus = snapshot.focus;
  const graph = snapshot.graph;

  const docPath = doc?.path ?? 'Active Document';
  parts.push(`<active_document path="${escapeXmlAttr(docPath)}">`);

  if (doc?.frontmatter && Object.keys(doc.frontmatter).length > 0) {
    try {
      const frontmatterJson = JSON.stringify(doc.frontmatter, null, 2);
      parts.push(`  <frontmatter>\n${indent(frontmatterJson, 4)}\n  </frontmatter>`);
    } catch {
      // Skip circular/unserializable frontmatter
    }
  }

  if (focus && focus.content) {
    const typeAttr = `type="${escapeXmlAttr(focus.type)}"`;
    const headingText = focus.headingPath?.length
      ? focus.headingPath[focus.headingPath.length - 1]
      : focus.heading;
    const headingAttr = headingText ? ` heading="${escapeXmlAttr(headingText)}"` : '';
    const rangeAttr = focus.range ? ` range="L${focus.range.startLine}-L${focus.range.endLine}"` : '';

    let contentToEmbed = focus.content;
    if (contentToEmbed.length > maxContentChars) {
      contentToEmbed = `${contentToEmbed.slice(0, maxContentChars)}\n\n[Content truncated due to size limit]`;
    }

    parts.push(`  <focus_scope ${typeAttr}${headingAttr}${rangeAttr}>\n${indent(contentToEmbed, 4)}\n  </focus_scope>`);
  }

  if (doc?.tableOfContents && doc.tableOfContents.length > 0) {
    const outlineItems = doc.tableOfContents.slice(0, maxOutlineEntries).map((item) => {
      const prefix = '#'.repeat(Math.max(1, Math.min(6, item.level)));
      return `    - ${prefix} ${item.heading} (L${item.line})`;
    });

    if (doc.tableOfContents.length > maxOutlineEntries) {
      outlineItems.push(`    - ... and ${doc.tableOfContents.length - maxOutlineEntries} more headings`);
    }

    parts.push(`  <document_outline>\n${outlineItems.join('\n')}\n  </document_outline>`);
  }

  if (graph) {
    const inlinks = (graph.inlinks || []).slice(0, maxLinks).join(', ');
    const outlinks = (graph.outlinks || []).slice(0, maxLinks).join(', ');

    if (inlinks || outlinks) {
      parts.push(`  <linked_references inlinks="${escapeXmlAttr(inlinks)}" outlinks="${escapeXmlAttr(outlinks)}" />`);
    }
  }

  parts.push('</active_document>');

  return `<${AMBIENT_CONTEXT_TAG}>\n${parts.join('\n')}\n</${AMBIENT_CONTEXT_TAG}>`;
}

function formatCanvasAmbientContext(
  snapshot: AmbientContextSnapshot,
  maxContentChars: number,
  maxLinks: number,
): string {
  const parts: string[] = [];
  const doc = snapshot.document;
  const focus = snapshot.focus;
  const graph = snapshot.graph;
  const canvasCtx = graph?.canvasContext;

  const canvasPath = doc?.path ?? 'Active Canvas';
  parts.push(`<active_canvas path="${escapeXmlAttr(canvasPath)}">`);

  if (focus?.content) {
    const nodeId = canvasCtx?.activeNodeId ? ` id="${escapeXmlAttr(canvasCtx.activeNodeId)}"` : '';
    let contentToEmbed = focus.content;
    if (contentToEmbed.length > maxContentChars) {
      contentToEmbed = `${contentToEmbed.slice(0, maxContentChars)}\n\n[Content truncated due to size limit]`;
    }
    parts.push(`  <focus_node${nodeId}>\n${indent(contentToEmbed, 4)}\n  </focus_node>`);
  }

  if (canvasCtx?.neighborNodes && canvasCtx.neighborNodes.length > 0) {
    const neighborItems = canvasCtx.neighborNodes.map(
      (n) => `    - [${n.relation}] ${n.id}: ${n.text}`,
    );
    parts.push(`  <canvas_neighbors>\n${neighborItems.join('\n')}\n  </canvas_neighbors>`);
  }

  if (graph) {
    const inlinks = (graph.inlinks || []).slice(0, maxLinks).join(', ');
    const outlinks = (graph.outlinks || []).slice(0, maxLinks).join(', ');
    if (inlinks || outlinks) {
      parts.push(`  <linked_references inlinks="${escapeXmlAttr(inlinks)}" outlinks="${escapeXmlAttr(outlinks)}" />`);
    }
  }

  parts.push('</active_canvas>');

  return `<${AMBIENT_CONTEXT_TAG}>\n${parts.join('\n')}\n</${AMBIENT_CONTEXT_TAG}>`;
}

export function stripAmbientContext(prompt: string): string {
  if (!prompt) return '';
  return prompt.replace(AMBIENT_CONTEXT_REGEX, '').trim();
}

function indent(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `${prefix}${line}` : line))
    .join('\n');
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
