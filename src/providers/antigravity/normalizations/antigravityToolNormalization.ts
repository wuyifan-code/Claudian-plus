export const ANTIGRAVITY_TOOL_STEP_TYPE = 'tool';

export interface AntigravityToolKeyParts {
  conversationId: string;
  turnIndex: number;
  stepIndex: number;
}

export interface AntigravityToolErrorInfo {
  type: string;
  message: string;
}

export interface AntigravityToolInfo {
  name: string;
  parameters: Record<string, unknown>;
  output: string;
  error: AntigravityToolErrorInfo | null;
}

/**
 * Stable tool identity for one `tool` step. The CLI reports no tool call ids of its own, so the
 * key is derived from the conversation, the runtime turn counter, and the stream step index.
 */
export function buildAntigravityToolKey(parts: AntigravityToolKeyParts): string {
  return `agy:${parts.conversationId}:turn${parts.turnIndex}:step${parts.stepIndex}`;
}

/**
 * Reads `tool_info` ({name, parameters, output, error{type,message}}) from a `tool` step_update
 * payload. The shape is documented but was never sampled live (A0 budget), so every field is
 * checked at runtime and anything unusable yields null instead of a guessed tool call.
 */
export function readAntigravityToolInfo(stepUpdate: unknown): AntigravityToolInfo | null {
  if (!isRecord(stepUpdate)) {
    return null;
  }
  const toolInfo = isRecord(stepUpdate.tool_info) ? stepUpdate.tool_info : null;
  if (!toolInfo) {
    return null;
  }
  const name = typeof toolInfo.name === 'string' && toolInfo.name.trim().length > 0
    ? toolInfo.name
    : null;
  if (!name) {
    return null;
  }

  return {
    name,
    parameters: isRecord(toolInfo.parameters) ? toolInfo.parameters : {},
    output: typeof toolInfo.output === 'string' ? toolInfo.output : '',
    error: readToolError(toolInfo.error),
  };
}

function readToolError(value: unknown): AntigravityToolErrorInfo | null {
  if (!isRecord(value) || typeof value.message !== 'string' || value.message.length === 0) {
    return null;
  }
  return {
    type: typeof value.type === 'string' && value.type.length > 0 ? value.type : 'unknown',
    message: value.message,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
