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
 * Kimi tool names as seen in `tool_call` titles and raw inputs. Kimi renders
 * titles capitalized (`Shell`, `Glob`); raw names, when present, are typically
 * the lower-case kebab form. Aliases such as `shell`→`Bash` and
 * `readfile`→`Read` are registered alongside the canonical names so the
 * dispatch key collapses them onto a single input/result handler.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  agent: TOOL_TASK,
  bash: TOOL_BASH,
  edit: TOOL_EDIT,
  editfile: TOOL_EDIT,
  fetchurl: TOOL_WEB_FETCH,
  glob: TOOL_GLOB,
  grep: TOOL_GREP,
  question: TOOL_ASK_USER_QUESTION,
  read: TOOL_READ,
  readfile: TOOL_READ,
  search: TOOL_GREP,
  searchweb: TOOL_WEB_SEARCH,
  shell: TOOL_BASH,
  skill: TOOL_SKILL,
  task: TOOL_TASK,
  todowrite: TOOL_TODO_WRITE,
  webfetch: TOOL_WEB_FETCH,
  websearch: TOOL_WEB_SEARCH,
  write: TOOL_WRITE,
  writefile: TOOL_WRITE,
};

/**
 * Kimi titles look like `Shell: ls -la`; the first whitespace-delimited
 * token, stripped of a trailing `:` or `-`, identifies the raw tool.
 */
const KIMI_TITLE_SPLITTER = (raw: string | null | undefined): string | undefined => {
  if (!raw) {
    return undefined;
  }
  const token = raw.split(/\s+/)[0]?.replace(/[:-]+$/, '').trim();
  return token && token.length > 0 ? token : undefined;
};

const normalization = createAcpToolNormalization({
  toolNameByRawKey: TOOL_NAME_MAP,
  extractTitleToken: KIMI_TITLE_SPLITTER,
  extraFilePathInputKeys: ['path'],
});

export const resolveKimiRawToolName = normalization.resolveRawToolName;
export const normalizeKimiToolName = normalization.normalizeToolName;
export const normalizeKimiToolInput = normalization.normalizeToolInput;
export const normalizeKimiToolUseResult = normalization.normalizeToolUseResult;

export function createKimiToolStreamAdapter() {
  return normalization.createStreamAdapter();
}
