import { stripInjectedPromptContext } from '../../../core/prompt/injectedContext';
import type { ChatMessage, ContentBlock, StreamChunk } from '../../../core/types/chat';
import type { ToolCallInfo } from '../../../core/types/tools';

export interface DshEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
  surfaceOp?: unknown;
}

const knownEvents = new Set([
  'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided', 'approval/policy',
  'assistant/attempt', 'assistant/message', 'command/done', 'command/run', 'compaction/end', 'compaction/prune',
  'compaction/start', 'compaction/summary', 'deliverables/presented', 'developer/message', 'feedback/message-delete',
  'feedback/message-put', 'feedback/record', 'goal/change', 'hook/invoked', 'hook/result', 'image/offload', 'llm/retry',
  'llm/retry-started', 'model/selection', 'permission/preset', 'plan/mode', 'request/context', 'request/header',
  'sandbox/mode', 'schedule/change', 'session-log-deepseek/delivery-accepted', 'session/end-seed', 'session/title',
  'session/title-llm-request', 'step/end', 'step/start', 'subagent/catalog', 'subagent/descriptor',
  'subagent/model-selection-policy', 'system/message', 'team/member', 'team/message/delivered', 'team/message/queued',
  'team/task', 'todo/write', 'tool-workflow/agent-end', 'tool-workflow/agent-start', 'tool-workflow/run-end',
  'tool-workflow/run-start', 'tool/call', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start', 'tool/result', 'turn/end',
  'turn/start', 'user/message', 'web/deepseek-search-llm-request', 'workspace/changes',
]);

export function isDshObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readDshEvent(record: unknown): DshEvent | null {
  if (!isDshObject(record) || record.type !== 'event') return null;
  const event = record.event;
  if (!isDshObject(event) || typeof event.type !== 'string' || !Number.isSafeInteger(event.seq)
    || (event.seq as number) < 0 || typeof event.time !== 'number' || !Number.isFinite(event.time)
    || event.time < 0 || !Object.hasOwn(event, 'data')) {
    throw new Error('Malformed DeepSeek session event.');
  }
  if (!knownEvents.has(event.type)) {
    if (event.ignorable !== true) throw new Error(`Unsupported required DeepSeek session event: ${event.type}`);
    return { ...event, data: {} } as unknown as DshEvent;
  }
  if (!isDshObject(event.data)) throw new Error('Malformed DeepSeek session event data.');
  return event as unknown as DshEvent;
}

function parseInput(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isDshObject(parsed)) return parsed;
  } catch { /* Native arguments are retained even when the model produced invalid JSON. */ }
  return { rawArguments: raw };
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.filter(isDshObject).filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string).join('');
}

/**
 * The harness stores whatever the client sent, including the system_context
 * block prepended to the user turn. Replay is the user's own message, so the
 * injected reference material is stripped rather than rendered as their words.
 */
export const stripInjectedSystemContext = stripInjectedPromptContext;

function addBlock(message: ChatMessage, block: ContentBlock): void {
  const blocks = message.contentBlocks ??= [];
  const last = blocks[blocks.length - 1];
  if (last?.type === 'text' && block.type === 'text') last.content += block.content;
  else if (last?.type === 'thinking' && block.type === 'thinking') last.content += block.content;
  else blocks.push(block);
  if (block.type === 'text') message.content += block.content;
}

function addTool(message: ChatMessage, data: Record<string, unknown>): void {
  const id = typeof data.id === 'string' ? data.id : data.callId;
  if (typeof id !== 'string' || typeof data.name !== 'string') return;
  const tools = message.toolCalls ??= [];
  if (tools.some(tool => tool.id === id)) return;
  tools.push({ id, name: data.name, input: parseInput(data.arguments), status: 'running' });
  addBlock(message, { type: 'tool_use', toolId: id });
}

/** Projects append-origin presentation history, retaining original messages across native compaction. */
export function mapDshRecordsToMessages(records: unknown[]): ChatMessage[] {
  const events = records.map(readDshEvent).filter((value): value is DshEvent => value !== null)
    .sort((left, right) => left.seq - right.seq);
  const seen = new Set<number>();
  const messages: ChatMessage[] = [];
  const tools = new Map<string, ToolCallInfo>();
  let assistant: ChatMessage | undefined;
  for (const event of events) {
    if (seen.has(event.seq)) continue;
    seen.add(event.seq);
    const data = event.data;
    if (event.type === 'user/message') {
      if (event.surfaceOp !== 'append' || !isDshObject(data.source) || data.source.kind !== 'user'
        || typeof data.id !== 'string' || data.role !== 'user' || !Array.isArray(data.content)) continue;
      assistant = undefined;
      messages.push({
        id: data.id,
        userMessageId: data.id,
        role: 'user',
        content: stripInjectedSystemContext(textContent(data.content)),
        timestamp: event.time,
      });
    } else if (event.type === 'assistant/message') {
      const native = data.message;
      if (event.surfaceOp !== 'append' || !isDshObject(native) || native.role !== 'assistant'
        || typeof native.id !== 'string' || !Array.isArray(native.content)) continue;
      assistant = { id: native.id, assistantMessageId: native.id, role: 'assistant', content: '', timestamp: event.time };
      for (const block of native.content) {
        if (!isDshObject(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string') addBlock(assistant, { type: 'text', content: block.text });
        else if (block.type === 'reasoning' && typeof block.text === 'string') addBlock(assistant, { type: 'thinking', content: block.text });
        else if (block.type === 'tool-call') addTool(assistant, block);
      }
      for (const tool of assistant.toolCalls ?? []) tools.set(tool.id, tool);
      messages.push(assistant);
    } else if (event.type === 'tool/call' && assistant) {
      addTool(assistant, data);
      for (const tool of assistant.toolCalls ?? []) tools.set(tool.id, tool);
    } else if (event.type === 'tool/result' && isDshObject(data.message)) {
      const native = data.message;
      const tool = typeof native.toolCallId === 'string' ? tools.get(native.toolCallId) : undefined;
      if (tool) {
        tool.status = native.isError === true ? 'error' : 'completed';
        tool.result = textContent(native.content);
      }
    }
  }
  return messages;
}

interface ActiveAttempt {
  id: string;
  turn: number;
  step: number;
  nextIndex: number;
  emitted: boolean;
  settled: boolean;
  blocks: Map<number, { type: string; text: string }>;
  toolBlocks: Map<string, Record<string, unknown>>;
}

/** Adapts the official follow stream; interrupted attempts fail closed because shared chunks cannot retract text. */
export class DshStreamNormalizer {
  invalidated = false;
  latestRequestId: string | null = null;
  activeTurn: number | null = null;
  endedTurn: number | null = null;
  private cursor = -1;
  private attempt?: ActiveAttempt;
  private tools = new Set<string>();

  accept(value: unknown): StreamChunk[] {
    if (this.invalidated || !isDshObject(value)) return [];
    if (value.type === 'snapshot') {
      if (Number.isSafeInteger(value.cursor)) this.cursor = value.cursor as number;
      return [];
    }
    if (value.type === 'assistant-stream' && isDshObject(value.frame)) return this.acceptFrame(value.frame);
    const event = readDshEvent(value);
    if (!event || event.seq <= this.cursor) return [];
    this.cursor = event.seq;
    const data = event.data;
    if (event.type === 'turn/start' && typeof data.turn === 'number') this.activeTurn = data.turn;
    if (event.type === 'user/message' && isDshObject(data.source) && data.source.kind === 'user') {
      if (typeof data.source.rpcId === 'string') this.latestRequestId = data.source.rpcId;
    }
    if (event.type === 'turn/end' && typeof data.turn === 'number') {
      this.endedTurn = data.turn;
      if (isDshObject(data.reason) && data.reason.kind === 'error' && isDshObject(data.reason.error)
        && typeof data.reason.error.message === 'string') return [{ type: 'error', content: data.reason.error.message }];
    }
    if (event.type === 'assistant/attempt' && this.matchesAttempt(data) && this.attempt?.emitted) return this.invalidate();
    if (event.type === 'assistant/message' && isDshObject(data.message) && Array.isArray(data.message.content)) {
      const chunks: StreamChunk[] = [];
      const active = this.matchesAttempt(data) ? this.attempt : undefined;
      if (this.attempt?.emitted && !this.attempt.settled && !active) return this.invalidate();
      if (active) {
        for (const [index, prior] of active.blocks) {
          const block: unknown = data.message.content[index];
          if (!isDshObject(block) || typeof block.text !== 'string' || !block.text.startsWith(prior.text)
            || (block.type === 'text' ? 'text' : block.type === 'reasoning' ? 'thinking' : '') !== prior.type) return this.invalidate();
        }
        for (const [id] of active.toolBlocks) {
          if (!data.message.content.some(block => isDshObject(block) && block.type === 'tool-call' && block.id === id)) return this.invalidate();
        }
      }
      for (const [index, block] of data.message.content.entries()) {
        if (!isDshObject(block)) continue;
        chunks.push(...this.acceptBlock(block, index, active));
        if (this.invalidated) return chunks;
      }
      if (active) active.settled = true;
      return chunks;
    }
    if (event.type === 'tool/call') return this.toolChunk(data);
    if (event.type === 'tool/result' && isDshObject(data.message) && typeof data.message.toolCallId === 'string') {
      return [{ type: 'tool_result', id: data.message.toolCallId, content: textContent(data.message.content), isError: data.message.isError === true }];
    }
    return [];
  }

  private matchesAttempt(data: Record<string, unknown>): boolean {
    return this.attempt !== undefined && this.attempt.turn === data.turn && this.attempt.step === data.step;
  }

  private acceptFrame(frame: Record<string, unknown>): StreamChunk[] {
    if (typeof frame.attemptId !== 'string') return [];
    if (frame.type === 'start') {
      if (this.attempt?.id === frame.attemptId) return [];
      if (this.attempt?.emitted && !this.attempt.settled) return this.invalidate();
      if (typeof frame.turn !== 'number' || typeof frame.step !== 'number') return [];
      this.attempt = { id: frame.attemptId, turn: frame.turn, step: frame.step, nextIndex: 0, emitted: false, settled: false, blocks: new Map(), toolBlocks: new Map() };
      return [];
    }
    const active = this.attempt;
    if (!active || frame.attemptId !== active.id || active.settled) return [];
    if (frame.type === 'end') {
      if (isDshObject(frame.outcome) && (frame.outcome.kind === 'abandoned' || frame.outcome.eventType === 'assistant/attempt')) {
        if (active.emitted) return this.invalidate();
        active.settled = true;
      }
      return [];
    }
    if (frame.type !== 'chunk' || !Number.isSafeInteger(frame.index) || !isDshObject(frame.chunk)) return [];
    if ((frame.index as number) < active.nextIndex) return [];
    if (frame.index !== active.nextIndex) return this.invalidate();
    active.nextIndex++;
    const chunk = frame.chunk;
    if (!Number.isSafeInteger(chunk.index) || (chunk.index as number) < 0) return [];
    const index = chunk.index as number;
    if ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && typeof chunk.text === 'string') {
      const type = chunk.type === 'text-delta' ? 'text' : 'thinking';
      const block = active.blocks.get(index);
      if (block && block.type !== type) return this.invalidate();
      active.blocks.set(index, { type, text: (block?.text ?? '') + chunk.text });
      if (!chunk.text) return [];
      active.emitted = true;
      return [{ type, content: chunk.text }];
    }
    if (chunk.type === 'block-end' && isDshObject(chunk.block)) return this.acceptBlock(chunk.block, index, active);
    return [];
  }

  private acceptBlock(block: Record<string, unknown>, index: number, active?: ActiveAttempt): StreamChunk[] {
    if (block.type === 'tool-call') {
      if (active && typeof block.id === 'string') {
        const prior = active.toolBlocks.get(block.id);
        if (prior && (prior.name !== block.name || prior.arguments !== block.arguments)) return this.invalidate();
        active.toolBlocks.set(block.id, block);
      }
      const chunks = this.toolChunk(block);
      if (active && chunks.length) active.emitted = true;
      return chunks;
    }
    if ((block.type !== 'text' && block.type !== 'reasoning') || typeof block.text !== 'string') return [];
    const type = block.type === 'text' ? 'text' : 'thinking';
    const prior = active?.blocks.get(index);
    if (prior && (prior.type !== type || !block.text.startsWith(prior.text))) return this.invalidate();
    const content = block.text.slice(prior?.text.length ?? 0);
    if (active) active.blocks.set(index, { type, text: block.text });
    if (!content) return [];
    if (active) active.emitted = true;
    return [{ type, content }];
  }

  private toolChunk(data: Record<string, unknown>): StreamChunk[] {
    const id = typeof data.id === 'string' ? data.id : data.callId;
    if (typeof id !== 'string' || typeof data.name !== 'string' || this.tools.has(id)) return [];
    this.tools.add(id);
    return [{ type: 'tool_use', id, name: data.name, input: parseInput(data.arguments) }];
  }

  private invalidate(): StreamChunk[] {
    this.invalidated = true;
    return [{ type: 'error', content: 'DeepSeek replaced a streamed attempt. Reopen this conversation to load the committed native history.' }];
  }
}
