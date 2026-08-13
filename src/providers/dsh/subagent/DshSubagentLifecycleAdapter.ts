import type {
  ProviderSubagentLaunchResult,
  ProviderSubagentLifecycleAdapter,
  ProviderSubagentWaitResult,
} from '../../../core/providers/types';
import type { SubagentInfo, ToolCallInfo } from '../../../core/types';

const DSH_SPAWN_TOOLS = new Set(['subagent', 'subagent_fork', 'workflow', 'ralph']);
const DSH_HIDDEN_TOOLS = new Set(['send_message', 'subagent_report']);

/**
 * DSH subagent lifecycle classification. DSH ACP streams no tool events, so
 * this adapter is inert on the current wire; it exists so the sidebar
 * subagent rendering path is contract-complete the moment a future transport
 * (SDK `session.event`) streams DSH tool calls.
 */
export const dshSubagentLifecycleAdapter: ProviderSubagentLifecycleAdapter = {
  isHiddenTool(name: string): boolean {
    return DSH_HIDDEN_TOOLS.has(name);
  },

  isSpawnTool(name: string): boolean {
    return DSH_SPAWN_TOOLS.has(name);
  },

  isWaitTool(_name: string): boolean {
    return false;
  },

  isCloseTool(_name: string): boolean {
    return false;
  },

  resolveSpawnToolIds(
    _waitToolCall: ToolCallInfo,
    _agentIdToSpawnId: ReadonlyMap<string, string>,
  ): string[] {
    return [];
  },

  buildSubagentInfo(
    spawnToolCall: ToolCallInfo,
    _siblingToolCalls: ToolCallInfo[] = [],
  ): SubagentInfo {
    const prompt = extractSubagentPrompt(spawnToolCall.input);
    const description = `DeepSeek ${spawnToolCall.name} subagent`;

    if (spawnToolCall.status === 'error') {
      return {
        id: spawnToolCall.id,
        description,
        prompt,
        mode: 'sync',
        isExpanded: false,
        status: 'error',
        result: spawnToolCall.result,
        toolCalls: [],
      };
    }

    return {
      id: spawnToolCall.id,
      description,
      prompt,
      mode: 'sync',
      isExpanded: false,
      status: spawnToolCall.status === 'completed' ? 'completed' : 'running',
      result: spawnToolCall.status === 'completed' ? spawnToolCall.result : undefined,
      toolCalls: [],
    };
  },

  extractSpawnResult(_raw: string | undefined): ProviderSubagentLaunchResult {
    return {};
  },

  extractWaitResult(_raw: string | undefined): ProviderSubagentWaitResult {
    return { statuses: {}, timedOut: false };
  },
};

function extractSubagentPrompt(input: Record<string, unknown>): string | undefined {
  for (const key of ['prompt', 'text', 'task']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
