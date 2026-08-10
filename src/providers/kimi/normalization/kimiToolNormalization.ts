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
import type { AskUserAnswers, AskUserQuestionItem } from '../../../core/types';
import type { SDKToolUseResult } from '../../../core/types/diff';
import { AcpToolStreamAdapter } from '../../acp';

/**
 * Kimi tool names as seen in `tool_call` titles and raw inputs. Kimi renders
 * titles capitalized (`Shell`, `Glob`); raw names, when present, are typically
 * the lower-case kebab form.
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

type KimiKnownToolName = keyof typeof TOOL_NAME_MAP;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isKnownToolName(value: unknown): value is KimiKnownToolName {
  if (typeof value !== 'string') {
    return false;
  }

  return value.trim().toLowerCase() in TOOL_NAME_MAP;
}

function toKnownToolName(value: string | undefined): KimiKnownToolName | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isKnownToolName(normalized)
    ? normalized
    : null;
}

function firstTrimmedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

function normalizeQuestionOptions(value: unknown): Array<{ description: string; label: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((option) => {
    if (typeof option === 'string') {
      const label = option.trim();
      return label ? [{ description: '', label }] : [];
    }

    if (!isPlainObject(option)) {
      return [];
    }

    const label = typeof option.label === 'string' ? option.label.trim() : '';
    if (!label) {
      return [];
    }

    return [{
      description: typeof option.description === 'string' ? option.description : '',
      label,
    }];
  });
}

function normalizeQuestionItems(value: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    const record = isPlainObject(item) ? item : {};
    const question = firstTrimmedString(record.question) ?? `Question ${index + 1}`;
    const header = firstTrimmedString(record.header) ?? `Q${index + 1}`;

    return {
      ...(typeof record.id === 'string' && record.id.trim()
        ? { id: record.id }
        : {}),
      header,
      multiSelect: record.multiSelect === true || record.multi_select === true || record.multiple === true,
      options: normalizeQuestionOptions(record.options),
      question,
    };
  });
}

function normalizeTodoStatus(value: unknown): 'completed' | 'in_progress' | 'pending' {
  switch (value) {
    case 'completed':
    case 'cancelled':
      return 'completed';
    case 'in_progress':
      return 'in_progress';
    default:
      return 'pending';
  }
}

function normalizeTodos(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isPlainObject(item)) {
      return [];
    }

    const content = firstTrimmedString(item.content, item.title, item.description);
    if (!content) {
      return [];
    }

    return [{
      activeForm: firstTrimmedString(item.activeForm, item.active_form) ?? content,
      content,
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      status: normalizeTodoStatus(item.status),
    }];
  });
}

function normalizeQuestionAnswers(
  rawAnswers: unknown,
  questions: AskUserQuestionItem[],
): AskUserAnswers | undefined {
  if (!Array.isArray(rawAnswers) || questions.length === 0) {
    return undefined;
  }

  const answers: AskUserAnswers = {};

  for (let index = 0; index < Math.min(rawAnswers.length, questions.length); index += 1) {
    const question = questions[index];
    const rawEntry = (rawAnswers as unknown[])[index];
    if (!question) {
      continue;
    }

    const values = Array.isArray(rawEntry)
      ? rawEntry
          .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      : typeof rawEntry === 'string' && rawEntry.trim().length > 0
      ? [rawEntry]
      : [];

    if (values.length === 0) {
      continue;
    }

    const normalizedValue = values.length === 1 ? values[0] : values;
    answers[question.question] = normalizedValue;
    if (question.id) {
      answers[question.id] = normalizedValue;
    }
  }

  return Object.keys(answers).length > 0 ? answers : undefined;
}

function extractToolMetadata(rawOutput: unknown): Record<string, unknown> | null {
  if (!isPlainObject(rawOutput)) {
    return null;
  }

  return isPlainObject(rawOutput.metadata) ? rawOutput.metadata : null;
}

export function resolveKimiRawToolName(
  currentRawName: string | undefined,
  update: {
    kind?: string | null;
    title?: string | null;
  },
): string {
  const titleName = firstTrimmedString(update.title);
  const titleToken = titleName
    ? titleName.split(/\s+/)[0]?.replace(/[:-]+$/, '').trim()
    : undefined;
  const knownTitleName = titleToken && isKnownToolName(titleToken)
    ? titleToken.trim().toLowerCase()
    : undefined;

  if (knownTitleName) {
    return knownTitleName;
  }

  if (currentRawName) {
    return currentRawName;
  }

  switch (update.kind) {
    case 'execute':
      return 'bash';
    case 'fetch':
      return 'webfetch';
    case 'read':
      return 'read';
    default:
      return titleToken ?? 'tool';
  }
}

export function normalizeKimiToolName(rawName: string | undefined): string {
  const knownName = toKnownToolName(rawName);
  if (!knownName) {
    return rawName?.trim() || 'tool';
  }

  return TOOL_NAME_MAP[knownName];
}

export function normalizeKimiToolInput(
  rawName: string | undefined,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const knownName = toKnownToolName(rawName);
  switch (knownName) {
    case 'question':
      return { questions: normalizeQuestionItems(input.questions) };
    case 'read':
    case 'readfile':
      return {
        ...(firstTrimmedString(input.file_path, input.filePath, input.path)
          ? { file_path: firstTrimmedString(input.file_path, input.filePath, input.path) }
          : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
      };
    case 'write':
    case 'writefile':
      return {
        ...(typeof input.content === 'string' ? { content: input.content } : {}),
        ...(firstTrimmedString(input.file_path, input.filePath, input.path)
          ? { file_path: firstTrimmedString(input.file_path, input.filePath, input.path) }
          : {}),
      };
    case 'edit':
    case 'editfile':
      return {
        ...(firstTrimmedString(input.file_path, input.filePath, input.path)
          ? { file_path: firstTrimmedString(input.file_path, input.filePath, input.path) }
          : {}),
        ...(firstTrimmedString(input.old_string, input.oldString)
          ? { old_string: firstTrimmedString(input.old_string, input.oldString) }
          : {}),
        ...(firstTrimmedString(input.new_string, input.newString)
          ? { new_string: firstTrimmedString(input.new_string, input.newString) }
          : {}),
        ...(typeof input.replace_all === 'boolean'
          ? { replace_all: input.replace_all }
          : typeof input.replaceAll === 'boolean'
          ? { replace_all: input.replaceAll }
          : {}),
      };
    case 'task':
    case 'agent':
      return {
        ...(firstTrimmedString(input.command) ? { command: firstTrimmedString(input.command) } : {}),
        ...(firstTrimmedString(input.description) ? { description: firstTrimmedString(input.description) } : {}),
        ...(firstTrimmedString(input.prompt) ? { prompt: firstTrimmedString(input.prompt) } : {}),
        ...(input.run_in_background === true || input.run_in_background === false
          ? { run_in_background: input.run_in_background }
          : {}),
        ...(firstTrimmedString(input.subagent_type) ? { subagent_type: firstTrimmedString(input.subagent_type) } : {}),
        ...(firstTrimmedString(input.task_id) ? { task_id: firstTrimmedString(input.task_id) } : {}),
      };
    case 'todowrite':
      return { todos: normalizeTodos(input.todos) };
    case 'skill':
      return firstTrimmedString(input.skill, input.name)
        ? { skill: firstTrimmedString(input.skill, input.name) }
        : {};
    default:
      return input;
  }
}

export function normalizeKimiToolUseResult(
  rawName: string | undefined,
  input: Record<string, unknown>,
  rawOutput: unknown,
): SDKToolUseResult | undefined {
  const knownName = toKnownToolName(rawName);
  const metadata = extractToolMetadata(rawOutput);
  const normalized: SDKToolUseResult = {};

  if (
    (knownName === 'write' || knownName === 'writefile' || knownName === 'edit' || knownName === 'editfile')
    && firstTrimmedString(
      input.file_path,
      input.filePath,
      input.path,
      metadata?.filepath,
      metadata?.filePath,
    )
  ) {
    normalized.filePath = firstTrimmedString(
      input.file_path,
      input.filePath,
      input.path,
      metadata?.filepath,
      metadata?.filePath,
    );
  }

  if (knownName === 'question') {
    const questions = Array.isArray(input.questions)
      ? input.questions as AskUserQuestionItem[]
      : [];
    const answers = normalizeQuestionAnswers(metadata?.answers, questions);
    if (answers) {
      normalized.answers = answers;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function createKimiToolStreamAdapter(): AcpToolStreamAdapter {
  return new AcpToolStreamAdapter({
    normalizeToolInput: normalizeKimiToolInput,
    normalizeToolName: normalizeKimiToolName,
    normalizeToolUseResult: normalizeKimiToolUseResult,
    resolveRawToolName: resolveKimiRawToolName,
  });
}
