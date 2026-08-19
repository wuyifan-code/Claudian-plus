import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import { createAcpToolNormalization } from '../../acp/toolNormalization';

/**
 * Raw tool names as they appear in OpenCode `tool_call` titles/inputs map
 * to the canonical shared tool names consumed by the chat runtime.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  bash: TOOL_BASH,
  edit: TOOL_EDIT,
  glob: TOOL_GLOB,
  grep: TOOL_GREP,
  question: TOOL_ASK_USER_QUESTION,
  read: TOOL_READ,
  skill: TOOL_SKILL,
  task: TOOL_TASK,
  todowrite: TOOL_TODO_WRITE,
  webfetch: TOOL_WEB_FETCH,
  websearch: TOOL_WEB_SEARCH,
  write: TOOL_WRITE,
};

const normalization = createAcpToolNormalization({ toolNameByRawKey: TOOL_NAME_MAP });

export const resolveOpencodeRawToolName = normalization.resolveRawToolName;
export const normalizeOpencodeToolName = normalization.normalizeToolName;
export const normalizeOpencodeToolInput = normalization.normalizeToolInput;
export const normalizeOpencodeToolUseResult = normalization.normalizeToolUseResult;

export function createOpencodeToolStreamAdapter() {
  return normalization.createStreamAdapter();
}
