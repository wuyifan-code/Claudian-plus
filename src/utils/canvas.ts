export interface CanvasSelectionContext {
  canvasPath: string;
  nodeIds: string[];
}

export type CanvasContextAction = 'analyze' | 'outline' | 'links' | 'neighbors';

export function buildCanvasActionPrompt(
  context: CanvasSelectionContext,
  action: CanvasContextAction,
): string {
  const instructionByAction: Record<CanvasContextAction, string> = {
    analyze: 'Read the Canvas structure first, then explain the relationships and propose a useful next step.',
    outline: 'Read the Canvas structure first, then turn the selected ideas into a clear hierarchical outline. If useful, propose Canvas nodes and edges to add, but wait for approval before writing.',
    links: 'Read the Canvas structure first, then find related notes in the vault using Obsidian links and graph tools. Cite the paths and explain why each connection is useful.',
    neighbors: 'Read the selected Canvas nodes and suggest one-hop neighboring notes from Obsidian’s resolved link graph. Explain the direction and why each neighbor is relevant before inserting anything.',
  };
  return [
    `Work with the selected nodes in Canvas "${context.canvasPath}".`,
    `Selected node IDs: ${context.nodeIds.join(', ')}`,
    instructionByAction[action],
  ].join('\n\n');
}

export function formatCanvasContext(context: CanvasSelectionContext): string {
  if (context.nodeIds.length === 0) return '';
  return `<canvas_selection path="${context.canvasPath}">\n${context.nodeIds.join(', ')}\n</canvas_selection>`;
}

export function appendCanvasContext(prompt: string, context: CanvasSelectionContext): string {
  const formatted = formatCanvasContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}
