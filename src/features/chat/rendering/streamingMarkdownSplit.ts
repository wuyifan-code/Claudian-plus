/**
 * Finds how much of a streaming markdown buffer can be committed to the DOM.
 *
 * Everything before the returned offset ends on a blank line outside a fenced
 * code block, so it will never be re-flowed by later deltas. The renderer keeps
 * that DOM as-is and only re-renders the tail, which turns per-frame cost from
 * O(whole message) into O(open block).
 */
export function findCommitBoundary(markdown: string): number {
  let inFence = false;
  let fenceChar = '';
  let boundary = 0;
  let offset = 0;

  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);

    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
      } else if (marker[0] === fenceChar) {
        inFence = false;
      }
    } else if (!inFence && line.trim() === '' && index > 0) {
      boundary = Math.min(markdown.length, offset + line.length + 1);
    }

    offset += line.length + 1;
  }

  return boundary;
}
