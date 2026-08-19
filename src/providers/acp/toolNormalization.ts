import type { SDKToolUseResult } from '../../core/types/diff';
import type { AskUserAnswers, AskUserQuestionItem } from '../../core/types/tools';
import {
  AcpToolStreamAdapter,
  type AcpToolStreamPresentationAdapter,
} from './AcpToolStreamAdapter';
// `AcpToolStreamAdapter` is also re-exported from `acp/index.ts`, so this
// module intentionally does not re-export it to avoid a name collision.

/**
 * Options for {@link createAcpToolNormalization}, the shared tool-name and
 * input/result normalizer factory consumed by the ACP-based providers.
 *
 * The factory exists so that OpenCode, Kimi, and future ACP providers can
 * share pure-function helpers (question/todo normalization, file-path
 * fallback handling, `kind` defaults) while keeping their raw-name map,
 * title-tokening rule, and any provider-specific file-path aliases in the
 * owning provider directory.
 */
export interface AcpToolNormalizationOptions<TKey extends string = string> {
  /**
   * Map from a raw tool name as it appears in tool calls to the canonical
   * shared tool name (e.g. `'bash'` → `'Bash'`). Lookup is case-insensitive
   * and trimmed. Entries may also be aliases that resolve to the same
   * canonical name, allowing providers to register their native variants
   * (e.g. Kimi `shell` → `Bash`).
   */
  toolNameByRawKey: Record<TKey, string>;

  /**
   * Optional rule that extracts the candidate raw-name token from a title
   * before it is checked against {@link toolNameByRawKey}. The OpenCode
   * default trims the whole title; Kimi's splitter takes the first
   * whitespace-delimited token and strips trailing `:` or `-`.
   */
  extractTitleToken?: (rawTitle: string | null | undefined) => string | undefined;

  /**
   * Additional input keys (besides `file_path` and `filePath`) that
   * providers accept as a file path on read/write/edit tools. Kimi uses
   * `'path'`; OpenCode does not need this.
   */
  extraFilePathInputKeys?: readonly string[];

  /**
   * Override the kind → raw-name default. Default maps `execute`→`bash`,
   * `fetch`→`webfetch`, `read`→`read`, otherwise falling through to the
   * title-derived or `tool` default.
   */
  kindFallbackName?: (kind: string | null | undefined) => string | undefined;
}

export interface AcpToolNormalization {
  resolveRawToolName: AcpToolStreamPresentationAdapter['resolveRawToolName'];
  normalizeToolName: AcpToolStreamPresentationAdapter['normalizeToolName'];
  normalizeToolInput: AcpToolStreamPresentationAdapter['normalizeToolInput'];
  normalizeToolUseResult: AcpToolStreamPresentationAdapter['normalizeToolUseResult'];
  createStreamAdapter(): AcpToolStreamAdapter;
}

/**
 * Shared tool-normalization builder for ACP-based providers. See
 * {@link AcpToolNormalizationOptions} for per-provider customization points.
 */
export function createAcpToolNormalization<TKey extends string = string>(
  options: AcpToolNormalizationOptions<TKey>,
): AcpToolNormalization {
  const extractTitleToken = options.extractTitleToken ?? defaultExtractTitleToken;
  const kindFallbackName = options.kindFallbackName ?? defaultKindFallbackName;
  const extraFilePathKeys = (options.extraFilePathInputKeys ?? []).filter(
    (key) => key !== 'file_path' && key !== 'filePath',
  );

  /**
   * Several providers carry multiple raw keys that resolve to the same
   * shared tool name (e.g. Kimi `read` + `readfile` → `Read`). Group entries
   * by their shared tool name and pick the shortest raw key per group as the
   * canonical dispatch key used by the input/result switch. Aliased raw
   * keys collapse onto the canonical one automatically.
   */
  const canonicalRawKey: Record<string, string> = (() => {
    const bySharedName: Record<string, string[]> = {};
    for (const rawKey of Object.keys(options.toolNameByRawKey) as TKey[]) {
      const shared = options.toolNameByRawKey[rawKey];
      (bySharedName[shared] ??= []).push(rawKey);
    }
    const result: Record<string, string> = {};
    for (const keys of Object.values(bySharedName)) {
      const canonical = [...keys].sort((a, b) => a.length - b.length)[0];
      for (const key of keys) {
        result[key] = canonical;
      }
    }
    return result;
  })();

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isKnownToolName(value: unknown): value is TKey {
    if (typeof value !== 'string') {
      return false;
    }
    return value.trim().toLowerCase() in options.toolNameByRawKey;
  }

  function toKnownToolName(value: string | undefined): TKey | null {
    if (!value) {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    return isKnownToolName(normalized) ? normalized : null;
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

  function firstNonEmptyString(...values: unknown[]): string {
    return firstTrimmedString(...values) ?? '';
  }

  /**
   * Resolve a file path from a named input record plus optional result
   * metadata. Reads `file_path`, `filePath`, then any extra keys provided
   * via {@link AcpToolNormalizationOptions.extraFilePathInputKeys}, then
   * the metadata `filepath` / `filePath`.
   */
  function resolveFilePath(
    named: Record<string, unknown>,
    metadata?: Record<string, unknown> | null,
  ): string | undefined {
    const extra = extraFilePathKeys.map((k) => named[k]);
    return firstTrimmedString(
      named.file_path,
      named.filePath,
      ...extra,
      metadata?.filepath,
      metadata?.filePath,
    );
  }

  function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const unique = new Set<string>();
    for (const entry of value) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed) {
        unique.add(trimmed);
      }
    }
    return [...unique];
  }

  function normalizeQuestionOptions(
    value: unknown,
  ): Array<{ description: string; label: string }> {
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
      return [
        {
          description:
            typeof option.description === 'string' ? option.description : '',
          label,
        },
      ];
    });
  }

  function normalizeQuestionItems(value: unknown): AskUserQuestionItem[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item, index) => {
      const record = isPlainObject(item) ? item : {};
      const question =
        firstTrimmedString(record.question) ?? `Question ${index + 1}`;
      const header = firstTrimmedString(record.header) ?? `Q${index + 1}`;

      return {
        ...(typeof record.id === 'string' && record.id.trim()
          ? { id: record.id }
          : {}),
        header,
        multiSelect:
          record.multiSelect === true ||
          record.multi_select === true ||
          record.multiple === true,
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
      const content = firstTrimmedString(
        item.content,
        item.title,
        item.description,
      );
      if (!content) {
        return [];
      }
      return [
        {
          activeForm:
            firstTrimmedString(item.activeForm, item.active_form) ?? content,
          content,
          ...(typeof item.id === 'string' ? { id: item.id } : {}),
          status: normalizeTodoStatus(item.status),
        },
      ];
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
        ? rawEntry.filter(
            (value: unknown): value is string =>
              typeof value === 'string' && value.trim().length > 0,
          )
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

  function normalizeWebSearchInput(
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const action = isPlainObject(input.action) ? input.action : {};
    const queries = normalizeStringArray(action.queries ?? input.queries);
    const query = firstNonEmptyString(action.query, input.query, queries[0]);
    const url = firstNonEmptyString(action.url, input.url);
    const pattern = firstNonEmptyString(action.pattern, input.pattern);
    const explicitType = firstNonEmptyString(
      action.type,
      input.actionType,
      input.action_type,
    );

    const actionType =
      explicitType ||
      (url && pattern
        ? 'find_in_page'
        : url
        ? 'open_page'
        : query || queries.length > 0
        ? 'search'
        : '');

    const normalized: Record<string, unknown> = {};
    if (actionType) {
      normalized.actionType = actionType;
    }
    if (query) {
      normalized.query = query;
    }
    if (queries.length > 0) {
      normalized.queries = queries;
    }
    if (url) {
      normalized.url = url;
    }
    if (pattern) {
      normalized.pattern = pattern;
    }
    return normalized;
  }

  function resolveRawToolName(
    currentRawName: string | undefined,
    update: { kind?: string | null; title?: string | null },
  ): string {
    const titleToken = extractTitleToken(update.title);
    const knownTitleName =
      titleToken && isKnownToolName(titleToken)
        ? titleToken.toLowerCase()
        : undefined;

    if (knownTitleName) {
      return knownTitleName;
    }
    if (currentRawName) {
      return currentRawName;
    }
    const kindDefault = kindFallbackName(update.kind);
    if (kindDefault) {
      return kindDefault;
    }
    return titleToken ?? 'tool';
  }

  function normalizeToolName(rawName: string | undefined): string {
    const knownName = toKnownToolName(rawName);
    if (!knownName) {
      return rawName?.trim() || 'tool';
    }
    return options.toolNameByRawKey[knownName];
  }

  function normalizeToolInput(
    rawName: string | undefined,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const knownName = toKnownToolName(rawName);
    const canonical = knownName ? canonicalRawKey[knownName] : undefined;
    switch (canonical) {
      case 'question':
        return { questions: normalizeQuestionItems(input.questions) };
      case 'read': {
        const filePath = resolveFilePath(input);
        return {
          ...(filePath ? { file_path: filePath } : {}),
          ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
          ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
        };
      }
      case 'write': {
        const filePath = resolveFilePath(input);
        return {
          ...(typeof input.content === 'string' ? { content: input.content } : {}),
          ...(filePath ? { file_path: filePath } : {}),
        };
      }
      case 'edit': {
        const filePath = resolveFilePath(input);
        return {
          ...(filePath ? { file_path: filePath } : {}),
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
      }
      case 'task':
      case 'agent':
        return {
          ...(firstTrimmedString(input.command)
            ? { command: firstTrimmedString(input.command) }
            : {}),
          ...(firstTrimmedString(input.description)
            ? { description: firstTrimmedString(input.description) }
            : {}),
          ...(firstTrimmedString(input.prompt)
            ? { prompt: firstTrimmedString(input.prompt) }
            : {}),
          ...(input.run_in_background === true || input.run_in_background === false
            ? { run_in_background: input.run_in_background }
            : {}),
          ...(firstTrimmedString(input.subagent_type)
            ? { subagent_type: firstTrimmedString(input.subagent_type) }
            : {}),
          ...(firstTrimmedString(input.task_id)
            ? { task_id: firstTrimmedString(input.task_id) }
            : {}),
        };
      case 'todowrite':
        return { todos: normalizeTodos(input.todos) };
      case 'skill':
        return firstTrimmedString(input.skill, input.name)
          ? { skill: firstTrimmedString(input.skill, input.name) }
          : {};
      case 'websearch':
        return normalizeWebSearchInput(input);
      default:
        return input;
    }
  }

  function normalizeToolUseResult(
    rawName: string | undefined,
    input: Record<string, unknown>,
    rawOutput: unknown,
  ): SDKToolUseResult | undefined {
    const knownName = toKnownToolName(rawName);
    const canonical = knownName ? canonicalRawKey[knownName] : undefined;
    const metadata = extractToolMetadata(rawOutput);
    const normalized: SDKToolUseResult = {};

    if (
      (canonical === 'write' || canonical === 'edit') &&
      (resolveFilePath(input) || resolveFilePath(metadata ?? {}))
    ) {
      const filePath =
        resolveFilePath(input) ?? resolveFilePath(metadata ?? {});
      if (filePath) {
        normalized.filePath = filePath;
      }
    }

    if (knownName === 'question') {
      const questions = Array.isArray(input.questions)
        ? (input.questions as AskUserQuestionItem[])
        : [];
      const answers = normalizeQuestionAnswers(metadata?.answers, questions);
      if (answers) {
        normalized.answers = answers;
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  function createStreamAdapter(): AcpToolStreamAdapter {
    return new AcpToolStreamAdapter({
      normalizeToolInput,
      normalizeToolName,
      normalizeToolUseResult,
      resolveRawToolName,
    });
  }

  return {
    resolveRawToolName,
    normalizeToolName,
    normalizeToolInput,
    normalizeToolUseResult,
    createStreamAdapter,
  };
}

function defaultExtractTitleToken(
  rawTitle: string | null | undefined,
): string | undefined {
  if (!rawTitle) {
    return undefined;
  }
  const trimmed = rawTitle.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultKindFallbackName(
  kind: string | null | undefined,
): string | undefined {
  switch (kind) {
    case 'execute':
      return 'bash';
    case 'fetch':
      return 'webfetch';
    case 'read':
      return 'read';
    default:
      return undefined;
  }
}
