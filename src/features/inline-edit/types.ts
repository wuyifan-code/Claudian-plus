import type { DiffLine } from '../../core/types/diff';
import type { EditorSelectionContext } from '../../utils/editor';

export type InlineEditStatus = 'idle' | 'generating' | 'previewing' | 'accepted' | 'rejected' | 'error';

export interface InlineEditRequest {
  instruction: string;
  context: EditorSelectionContext;
  fileContent?: string;
}

export interface InlineEditResult {
  originalText: string;
  replacementText: string;
  diffLines: DiffLine[];
}
