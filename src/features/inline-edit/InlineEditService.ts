import type { AuxQueryRunner } from '../../core/auxiliary/AuxQueryRunner';
import type { DiffLine } from '../../core/types/diff';
import type { InlineEditRequest, InlineEditResult } from './types';

export function computeLineDiff(originalText: string, newText: string): DiffLine[] {
  const oldLines = originalText ? originalText.split(/\r?\n/) : [];
  const newLines = newText ? newText.split(/\r?\n/) : [];

  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const diffs: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffs.unshift({ type: 'equal', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffs.unshift({ type: 'insert', text: newLines[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffs.unshift({ type: 'delete', text: oldLines[i - 1] });
      i--;
    }
  }

  return diffs;
}

export class InlineEditService {
  constructor(private readonly getRunner: () => AuxQueryRunner) {}

  async generateEdit(
    request: InlineEditRequest,
    options?: {
      abortController?: AbortController;
      onChunk?: (interimResult: InlineEditResult) => void;
    }
  ): Promise<InlineEditResult> {
    const runner = this.getRunner();
    const originalText = request.context.selectedText ?? '';

    const systemPrompt = `You are an AI editor pair programming inside Obsidian.
The user wants to edit or generate text/code based on the provided editor context.
Return ONLY the replacement text for the selection. Do not include markdown code block backticks unless the user explicitly requested markdown code fences or the selection already had them. Do not include conversational filler or explanations.`;

    let userPrompt = `User instruction: ${request.instruction}\n\n`;
    if (request.context.selectedText) {
      userPrompt += `Original selected text:\n\`\`\`\n${request.context.selectedText}\n\`\`\``;
    } else if (request.context.cursorContext) {
      const ctx = request.context.cursorContext;
      userPrompt += `Surrounding text before cursor:\n${ctx.beforeCursor}\n\nSurrounding text after cursor:\n${ctx.afterCursor}`;
    }

    const finalOutput = await runner.query(
      {
        systemPrompt,
        abortController: options?.abortController,
        onTextChunk: (accumulated) => {
          if (options?.onChunk) {
            const diff = computeLineDiff(originalText, accumulated);
            options.onChunk({
              originalText,
              replacementText: accumulated,
              diffLines: diff,
            });
          }
        },
      },
      userPrompt
    );

    let cleaned = finalOutput.trim();
    const codeBlockMatch = cleaned.match(/^```[\w]*\r?\n([\s\S]*?)\r?\n```$/);
    if (codeBlockMatch && !originalText.startsWith('```')) {
      cleaned = codeBlockMatch[1];
    }

    return {
      originalText,
      replacementText: cleaned,
      diffLines: computeLineDiff(originalText, cleaned),
    };
  }
}
