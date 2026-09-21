import type { StreamChunk, UsageInfo } from '../../../core/types';
import {
  ANTIGRAVITY_TOOL_STEP_TYPE,
  buildAntigravityToolKey,
  isRecord,
  readAntigravityToolInfo,
} from './antigravityToolNormalization';

export type AntigravityEventKind = 'init' | 'step_update' | 'result' | 'unknown';

export interface AntigravityInitInfo {
  conversationId: string;
  model: string | null;
  permissionMode: string | null;
}

export interface AntigravityStepUpdate {
  /** Raw step_update payload record, kept for provider-native fields such as tool_info. */
  payload: Record<string, unknown>;
  conversationId: string;
  stepIndex: number;
  state: string;
  stepType: string;
  textDelta: string | null;
}

export type AntigravityResultStatus = 'success' | 'error' | 'cancelled' | 'interrupted' | 'unknown';

export interface AntigravityResultInfo {
  conversationId: string;
  /** Provider-native status string, passed through unchanged (SUCCESS, ERROR, ...). */
  status: string;
  normalizedStatus: AntigravityResultStatus;
  response: string;
  error: string | null;
  usage: Record<string, unknown> | null;
}

export interface AntigravityEventNormalizationOptions {
  turnIndex: number;
}

export interface AntigravityEventNormalizationState {
  turnIndex: number;
  boundSessionId: string | null;
  boundModel: string | null;
  accumulatedText: string;
  finalResponseSettled: boolean;
  emittedToolUseIds: Set<string>;
  settledToolIds: Set<string>;
  duplicateToolResultCount: number;
  responseMismatchCount: number;
}

export function createAntigravityEventNormalizationState(
  options: AntigravityEventNormalizationOptions,
): AntigravityEventNormalizationState {
  return {
    turnIndex: options.turnIndex,
    boundSessionId: null,
    boundModel: null,
    accumulatedText: '',
    finalResponseSettled: false,
    emittedToolUseIds: new Set<string>(),
    settledToolIds: new Set<string>(),
    duplicateToolResultCount: 0,
    responseMismatchCount: 0,
  };
}

export function classifyAntigravityEvent(record: Record<string, unknown>): AntigravityEventKind {
  if (record.event === 'init') {
    return 'init';
  }
  if (record.event === 'step_update') {
    return 'step_update';
  }
  if (record.event === 'result') {
    return 'result';
  }
  // The json-format ERROR envelope is captured evidence with no `event` field
  // (unknown-model mock run); it is result-shaped and must settle the turn.
  if (record.event === undefined && isResultShapedEnvelope(record)) {
    return 'result';
  }
  return 'unknown';
}

function isResultShapedEnvelope(record: Record<string, unknown>): boolean {
  return typeof record.status === 'string' && typeof record.response === 'string';
}

export function readAntigravityInit(record: Record<string, unknown>): AntigravityInitInfo | null {
  if (!isRecord(record.init)) {
    return null;
  }
  return {
    conversationId: typeof record.conversation_id === 'string' ? record.conversation_id : '',
    model: typeof record.init.model === 'string' ? record.init.model : null,
    permissionMode: typeof record.init.permission_mode === 'string' ? record.init.permission_mode : null,
  };
}

export function readAntigravityStepUpdate(
  record: Record<string, unknown>,
): AntigravityStepUpdate | null {
  const payload = isRecord(record.step_update) ? record.step_update : null;
  if (!payload) {
    return null;
  }
  const stepIndex = payload.step_index;
  if (typeof stepIndex !== 'number' || !Number.isFinite(stepIndex)) {
    return null;
  }
  if (typeof payload.state !== 'string' || payload.state.length === 0) {
    return null;
  }
  if (typeof payload.step_type !== 'string' || payload.step_type.length === 0) {
    return null;
  }

  return {
    payload,
    conversationId: typeof payload.conversation_id === 'string' ? payload.conversation_id : '',
    stepIndex,
    state: payload.state,
    stepType: payload.step_type,
    textDelta: typeof payload.text_delta === 'string' ? payload.text_delta : null,
  };
}

export function readAntigravityResult(record: Record<string, unknown>): AntigravityResultInfo | null {
  let payload: unknown;
  if (record.event === 'result') {
    payload = record.result;
  } else if (record.event === undefined && isResultShapedEnvelope(record)) {
    payload = record;
  } else {
    return null;
  }
  if (!isRecord(payload)) {
    return null;
  }
  const status = payload.status;
  if (typeof status !== 'string' || status.length === 0) {
    return null;
  }
  if (typeof payload.response !== 'string') {
    return null;
  }

  return {
    conversationId: typeof payload.conversation_id === 'string' ? payload.conversation_id : '',
    status,
    normalizedStatus: getAntigravityResultStatus(status),
    response: payload.response,
    error: typeof payload.error === 'string' && payload.error.length > 0 ? payload.error : null,
    usage: isRecord(payload.usage) ? payload.usage : null,
  };
}

export function getAntigravityResultStatus(status: string): AntigravityResultStatus {
  switch (status) {
    case 'SUCCESS':
      return 'success';
    case 'ERROR':
      return 'error';
    // Docs-only statuses (headless docs); no live sample exists yet.
    case 'CANCELED':
      return 'cancelled';
    case 'INTERRUPTED':
      return 'interrupted';
    default:
      return 'unknown';
  }
}

/**
 * Normalizes one already-parsed CLI event into provider-neutral stream chunks. Text deltas of
 * `agent_response` steps accumulate in stream order; the terminal result response is deduped
 * against that accumulation (see computeResponseSuffix). Tool activity never becomes assistant
 * prose, init metadata never becomes a message, and usage is emitted at most once per turn from
 * the terminal result so step-level and result-level usage are never double counted.
 */
export function normalizeAntigravityEvent(
  record: Record<string, unknown>,
  state: AntigravityEventNormalizationState,
): StreamChunk[] {
  switch (classifyAntigravityEvent(record)) {
    case 'init':
      return normalizeInit(record, state);
    case 'step_update':
      return normalizeStepUpdate(record, state);
    case 'result':
      return normalizeResult(record, state);
    default:
      return [];
  }
}

export function getAntigravityAccumulatedText(state: AntigravityEventNormalizationState): string {
  return state.accumulatedText;
}

function normalizeInit(
  record: Record<string, unknown>,
  state: AntigravityEventNormalizationState,
): StreamChunk[] {
  const info = readAntigravityInit(record);
  if (!info) {
    return [malformedNotice('Antigravity sent a malformed init event.')];
  }
  if (info.conversationId && !state.boundSessionId) {
    state.boundSessionId = info.conversationId;
    state.boundModel = info.model;
  } else if (info.conversationId && state.boundSessionId && info.conversationId !== state.boundSessionId) {
    return [{ type: 'notice', content: 'Antigravity sent a second init event for a different conversation.', level: 'warning' }];
  }
  return [];
}

function normalizeStepUpdate(
  record: Record<string, unknown>,
  state: AntigravityEventNormalizationState,
): StreamChunk[] {
  const info = readAntigravityStepUpdate(record);
  if (!info) {
    return [malformedNotice('Antigravity sent a malformed step_update event.')];
  }
  if (state.finalResponseSettled) {
    return [];
  }
  if (info.stepType === ANTIGRAVITY_TOOL_STEP_TYPE) {
    return normalizeToolStep(info, state);
  }
  if (info.stepType === 'agent_response') {
    if (info.textDelta) {
      state.accumulatedText += info.textDelta;
      return [{ type: 'text', content: info.textDelta }];
    }
    return [];
  }
  if (info.state !== 'ACTIVE' && info.state !== 'DONE' && info.state !== 'ERROR') {
    return [{
      type: 'notice',
      content: `Antigravity step ${info.stepIndex} reported unknown state "${info.state}".`,
      level: 'warning',
    }];
  }
  return [];
}

function normalizeToolStep(
  info: AntigravityStepUpdate,
  state: AntigravityEventNormalizationState,
): StreamChunk[] {
  const toolInfo = readAntigravityToolInfo(info.payload);
  if (!toolInfo) {
    return [{ type: 'notice', content: 'Antigravity sent a tool step without a usable tool_info payload.', level: 'warning' }];
  }

  const key = buildAntigravityToolKey({
    conversationId: info.conversationId || state.boundSessionId || '',
    turnIndex: state.turnIndex,
    stepIndex: info.stepIndex,
  });
  const chunks: StreamChunk[] = [];
  if (!state.emittedToolUseIds.has(key)) {
    state.emittedToolUseIds.add(key);
    chunks.push({ type: 'tool_use', id: key, name: toolInfo.name, input: toolInfo.parameters });
  }
  if (info.state === 'DONE' || info.state === 'ERROR') {
    if (state.settledToolIds.has(key)) {
      state.duplicateToolResultCount += 1;
    } else {
      state.settledToolIds.add(key);
      const isError = toolInfo.error !== null || info.state === 'ERROR';
      const content = toolInfo.error
        ? toolInfo.error.message
        : (toolInfo.output || (info.state === 'ERROR' ? 'Tool execution failed or was denied' : ''));
      chunks.push({
        type: 'tool_result',
        id: key,
        content,
        isError,
        toolUseResult: isRecord(info.payload.tool_info) ? info.payload.tool_info : {},
      });
      if (typeof content === 'string' && content.includes('Tool is running as a background task with task id:')) {
        chunks.push({
          type: 'notice',
          content: 'Antigravity CLI moved a long command to the background. In headless print mode, background tasks are terminated when the turn finishes.',
          level: 'warning',
        });
      }
    }
  } else if (info.state !== 'ACTIVE') {
    chunks.push({
      type: 'notice',
      content: `Antigravity step ${info.stepIndex} reported unknown state "${info.state}".`,
      level: 'warning',
    });
  }
  return chunks;
}

function normalizeResult(
  record: Record<string, unknown>,
  state: AntigravityEventNormalizationState,
): StreamChunk[] {
  const info = readAntigravityResult(record);
  if (!info) {
    return [{ type: 'error', content: 'Antigravity sent a malformed result event.' }];
  }
  if (state.finalResponseSettled) {
    return [];
  }
  state.finalResponseSettled = true;

  const chunks: StreamChunk[] = [];
  const usage = info.usage ? buildAntigravityUsageInfo(info.usage, state.boundModel) : null;
  if (usage) {
    chunks.push({ type: 'usage', usage, sessionId: state.boundSessionId });
  }
  switch (info.normalizedStatus) {
    case 'success': {
      const extra = computeResponseSuffix(state.accumulatedText, info.response, state);
      if (extra) {
        state.accumulatedText += extra;
        chunks.push({ type: 'text', content: extra });
      } else if (!state.accumulatedText && !info.response) {
        const deniedCount = isRecord(record.result) && Array.isArray(record.result.denied_actions)
          ? record.result.denied_actions.length
          : 0;
        if (deniedCount > 0) {
          chunks.push({
            type: 'notice',
            content: `Antigravity finished with no output because ${deniedCount} tool call(s) were auto-denied by permission policy. Enable auto-approve tools in settings to allow tool execution.`,
            level: 'warning',
          });
        }
      }
      break;
    }
    case 'error': {
      let errorMessage = info.error ?? 'Antigravity turn failed.';
      if (
        errorMessage.includes('Eligibility check failed')
        || errorMessage.includes('daily-cloudcode-pa.googleapis.com')
        || errorMessage.includes('connectex')
        || errorMessage.includes('EOF')
      ) {
        errorMessage = `Antigravity connection error: Unable to connect to Google Cloud Code API (daily-cloudcode-pa.googleapis.com). If you are using a proxy or VPN (such as Clash, v2ray, or TUN mode), please verify your proxy route rules for Google services. Details: ${errorMessage}`;
      }
      chunks.push({ type: 'error', content: errorMessage });
      break;
    }
    case 'cancelled':
      chunks.push({ type: 'notice', content: 'Antigravity turn was cancelled.', level: 'warning' });
      break;
    case 'interrupted':
      chunks.push({ type: 'notice', content: 'Antigravity turn was interrupted.', level: 'warning' });
      break;
    default:
      chunks.push({ type: 'error', content: `Antigravity result reported unknown status "${info.status}".` });
  }
  return chunks;
}

/**
 * Dedupe rule for the terminal response against accumulated deltas:
 * - accumulated empty → the response is the only assistant text (only-final-text group);
 * - response equals or extends the accumulation → emit only the missing suffix
 *   (delta-plus-final and multi-step groups emit nothing when they match exactly);
 * - otherwise the two disagree (unverified shape) — keep the streamed text, count the anomaly,
 *   and never render the final response twice.
 */
function computeResponseSuffix(
  accumulated: string,
  response: string,
  state: AntigravityEventNormalizationState,
): string {
  if (!accumulated) {
    return response;
  }
  if (response === accumulated) {
    return '';
  }
  if (response.startsWith(accumulated)) {
    return response.slice(accumulated.length);
  }
  state.responseMismatchCount += 1;
  return '';
}

/**
 * Maps the provider-native usage record onto the shared contract. The CLI reports token counts
 * but no context window and no account quota, so the window stays unknown (0, non-authoritative)
 * and input tokens are never presented as remaining credit.
 */
export function buildAntigravityUsageInfo(
  usage: Record<string, unknown>,
  model?: string | null,
): UsageInfo | null {
  const inputTokens = getFiniteNumber(usage.input_tokens) ?? 0;
  const outputTokens = getFiniteNumber(usage.output_tokens) ?? 0;
  const thinkingTokens = getFiniteNumber(usage.thinking_tokens) ?? 0;
  const cacheReadTokens = getFiniteNumber(usage.cache_read_tokens) ?? 0;
  const totalTokens = getFiniteNumber(usage.total_tokens) ?? 0;
  if (inputTokens === 0 && outputTokens === 0 && thinkingTokens === 0 && cacheReadTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: cacheReadTokens,
    contextTokens: inputTokens,
    contextWindow: 0,
    contextWindowIsAuthoritative: false,
    inputTokens,
    ...(model ? { model } : {}),
    percentage: 0,
  };
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function malformedNotice(content: string): StreamChunk {
  return { type: 'notice', content, level: 'warning' };
}
