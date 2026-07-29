import { type EditorView, type PluginValue,ViewPlugin } from '@codemirror/view';

export interface AgentInlineSubmitContext {
  instruction: string;
  view: EditorView;
}

export interface AgentInlinePluginOptions {
  onSubmit: (context: AgentInlineSubmitContext) => void;
}

const AGENT_INLINE_PATTERN = /^\s*@agent\s+(.+?)\s*$/i;
const AGENT_BLOCK_START = /^\s*@agent\s*$/i;
const AGENT_BLOCK_END = /^\s*@end\s*$/i;

/**
 * Turns a line containing `@agent instruction` into an inline edit request.
 *
 * Supports two syntaxes:
 * 1. Single-line: `@agent improve this paragraph` + Enter
 * 2. Multi-line block:
 *    ```
 *    @agent
 *    Rewrite the following section with clearer transitions
 *    and add a concrete example.
 *    @end
 *    ```
 *    Press Enter on the `@end` line to submit.
 *
 * The command is deliberately line-scoped for single-line mode: it is
 * predictable with Markdown editing, works in both Live Preview and Source
 * mode, and never interprets ordinary prose containing an email address as
 * an agent command.
 */
export function createAgentInlinePlugin(options: AgentInlinePluginOptions) {
  return ViewPlugin.fromClass(class implements PluginValue {
    private readonly handleKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

      const { view } = this;
      const selection = view.state.selection.main;
      if (!selection.empty) return;

      const line = view.state.doc.lineAt(selection.head);

      // Try single-line syntax first.
      const singleMatch = line.text.match(AGENT_INLINE_PATTERN);
      if (singleMatch?.[1]?.trim()) {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({
          changes: { from: line.from, to: line.to },
          selection: { anchor: line.from },
        });
        options.onSubmit({ instruction: singleMatch[1].trim(), view });
        return;
      }

      // Try multi-line block syntax: cursor must be on the @end line.
      if (AGENT_BLOCK_END.test(line.text)) {
        const block = this.findBlockBefore(line.number);
        if (block) {
          event.preventDefault();
          event.stopPropagation();
          view.dispatch({
            changes: { from: block.startFrom, to: line.to },
            selection: { anchor: block.startFrom },
          });
          options.onSubmit({ instruction: block.instruction, view });
        }
      }
    };

    private findBlockBefore(endLineNumber: number): { startFrom: number; instruction: string } | null {
      const { doc } = this.view.state;
      const bodyLines: string[] = [];
      for (let lineNumber = endLineNumber - 1; lineNumber >= 1; lineNumber -= 1) {
        const candidate = doc.line(lineNumber);
        if (AGENT_BLOCK_START.test(candidate.text)) {
          const instruction = bodyLines.reverse().join('\n').trim();
          if (!instruction) return null;
          return { startFrom: candidate.from, instruction };
        }
        // Stop searching if we hit another @end or more than 50 lines.
        if (AGENT_BLOCK_END.test(candidate.text) || endLineNumber - lineNumber > 50) {
          return null;
        }
        bodyLines.push(candidate.text);
      }
      return null;
    }

    constructor(readonly view: EditorView) {
      view.dom.addEventListener('keydown', this.handleKeydown, true);
    }

    destroy(): void {
      this.view.dom.removeEventListener('keydown', this.handleKeydown, true);
    }
  });
}

