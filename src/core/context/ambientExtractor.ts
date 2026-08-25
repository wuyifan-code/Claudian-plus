import type { CachedMetadata, HeadingCache } from 'obsidian';

import type { CanvasData } from '../obsidian/canvas';
import type {
  AmbientDocumentContext,
  AmbientFocusContext,
  AmbientGraphContext,
  AmbientHeading,
  CanvasNeighborNode,
  CanvasNodeContext,
  EditorLike,
} from './types';

export interface FileItemInfo {
  path: string;
  basename: string;
  extension: string;
}

/**
 * Extracts L2 document-level context including path, frontmatter, tags, and table of contents.
 */
export function extractDocumentContext(
  file: FileItemInfo,
  cache?: CachedMetadata | null,
  content?: string,
): AmbientDocumentContext {
  const frontmatter = cache?.frontmatter ? { ...cache.frontmatter } : null;
  if (frontmatter && 'position' in frontmatter) {
    delete frontmatter.position;
  }

  const tagsSet = new Set<string>();

  // Extract from inline tags cache
  if (cache?.tags) {
    for (const tagInfo of cache.tags) {
      if (tagInfo.tag) {
        tagsSet.add(tagInfo.tag);
      }
    }
  }

  // Extract from frontmatter tags
  if (frontmatter?.tags) {
    if (Array.isArray(frontmatter.tags)) {
      for (const t of frontmatter.tags) {
        if (typeof t === 'string' && t.trim()) {
          tagsSet.add(t.trim());
        }
      }
    } else if (typeof frontmatter.tags === 'string') {
      for (const t of frontmatter.tags.split(/[\s,]+/)) {
        if (t.trim()) {
          tagsSet.add(t.trim());
        }
      }
    }
  }

  const tableOfContents: AmbientHeading[] = (cache?.headings ?? []).map((h) => ({
    heading: h.heading,
    level: h.level,
    line: (h.position?.start?.line ?? 0) + 1,
  }));

  const wordCount = content ? content.trim().split(/\s+/).filter(Boolean).length : undefined;
  const lineCount = content ? content.split(/\r?\n/).length : undefined;

  return {
    path: file.path,
    basename: file.basename,
    extension: file.extension,
    frontmatter: frontmatter && Object.keys(frontmatter).length > 0 ? frontmatter : null,
    tags: Array.from(tagsSet),
    tableOfContents,
    wordCount,
    lineCount,
  };
}

/**
 * Extracts L1 immediate focus context.
 * Prioritizes active text selection; falls back to current section based on cursor line and headings;
 * or falls back to full document.
 */
export function extractFocusContext(
  editor: EditorLike,
  headings?: HeadingCache[],
  fullContent?: string,
): AmbientFocusContext | null {
  const selectedText = editor.getSelection?.() ?? '';
  if (selectedText.trim()) {
    const from = editor.getCursor?.('from') ?? { line: 0, ch: 0 };
    const to = editor.getCursor?.('to') ?? { line: 0, ch: 0 };
    return {
      type: 'selection',
      range: {
        startLine: from.line + 1,
        endLine: to.line + 1,
      },
      content: selectedText,
    };
  }

  const cursor = editor.getCursor?.() ?? { line: 0, ch: 0 };
  const content = fullContent ?? (typeof editor.getValue === 'function' ? editor.getValue() : '');
  const lines = content ? content.split(/\r?\n/) : [];

  if (headings && headings.length > 0) {
    // Find the last heading whose start line is before or at the cursor line
    let activeHeadingIndex = -1;
    for (let i = 0; i < headings.length; i++) {
      const headingLine = headings[i].position?.start?.line ?? 0;
      if (headingLine <= cursor.line) {
        activeHeadingIndex = i;
      } else {
        break;
      }
    }

    if (activeHeadingIndex >= 0) {
      const activeHeading = headings[activeHeadingIndex];
      const startLine = activeHeading.position?.start?.line ?? 0;

      // Find the end line: next heading with level <= activeHeading.level, or end of file
      let endLine = lines.length > 0 ? lines.length - 1 : startLine;
      for (let i = activeHeadingIndex + 1; i < headings.length; i++) {
        const nextHeading = headings[i];
        if (nextHeading.level <= activeHeading.level) {
          endLine = Math.max(startLine, (nextHeading.position?.start?.line ?? 0) - 1);
          break;
        }
      }

      // Build heading path
      const headingPath: string[] = [];
      let currentLevel = activeHeading.level;
      headingPath.unshift(`${'#'.repeat(activeHeading.level)} ${activeHeading.heading}`);

      for (let i = activeHeadingIndex - 1; i >= 0; i--) {
        const prevHeading = headings[i];
        if (prevHeading.level < currentLevel) {
          headingPath.unshift(`${'#'.repeat(prevHeading.level)} ${prevHeading.heading}`);
          currentLevel = prevHeading.level;
          if (currentLevel === 1) break;
        }
      }

      const sectionContent = lines.slice(startLine, endLine + 1).join('\n');

      return {
        type: 'section',
        heading: activeHeading.heading,
        headingPath,
        range: {
          startLine: startLine + 1,
          endLine: endLine + 1,
        },
        content: sectionContent,
      };
    }
  }

  // Fallback: full document
  return {
    type: 'full_document',
    content,
  };
}

/**
 * Extracts L3 graph context (inlinks and outlinks) from Obsidian's in-memory resolvedLinks cache.
 */
export function extractGraphContext(
  filePath: string,
  resolvedLinks?: Record<string, Record<string, number>> | null,
): AmbientGraphContext {
  const outlinks: string[] = [];
  const inlinks: string[] = [];

  if (resolvedLinks) {
    // Outlinks from current file
    const fileOutlinks = resolvedLinks[filePath];
    if (fileOutlinks) {
      outlinks.push(...Object.keys(fileOutlinks));
    }

    // Inlinks targeting current file
    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      if (sourcePath !== filePath && targets && targets[filePath]) {
        inlinks.push(sourcePath);
      }
    }
  }

  return {
    inlinks,
    outlinks,
  };
}

/**
 * Extracts Canvas node context and 1-hop connected neighbors.
 */
export function extractCanvasContext(
  canvasData: CanvasData | null | undefined,
  activeNodeId?: string,
): CanvasNodeContext | null {
  if (!canvasData || !activeNodeId) return null;

  const nodeMap = new Map(canvasData.nodes.map((n) => [n.id, n]));
  const activeNode = nodeMap.get(activeNodeId);
  if (!activeNode) return null;

  const neighborNodes: CanvasNeighborNode[] = [];

  for (const edge of canvasData.edges) {
    if (edge.fromNode === activeNodeId) {
      const targetNode = nodeMap.get(edge.toNode);
      if (targetNode) {
        const file = typeof (targetNode as { file?: string }).file === 'string'
          ? (targetNode as { file?: string }).file
          : '';
        neighborNodes.push({
          id: targetNode.id,
          text: targetNode.text || file || targetNode.id,
          relation: 'points_to',
        });
      }
    } else if (edge.toNode === activeNodeId) {
      const sourceNode = nodeMap.get(edge.fromNode);
      if (sourceNode) {
        const file = typeof (sourceNode as { file?: string }).file === 'string'
          ? (sourceNode as { file?: string }).file
          : '';
        neighborNodes.push({
          id: sourceNode.id,
          text: sourceNode.text || file || sourceNode.id,
          relation: 'pointed_from',
        });
      }
    }
  }

  return {
    activeNodeId,
    neighborNodes,
  };
}
