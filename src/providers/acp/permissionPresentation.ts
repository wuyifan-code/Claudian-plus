export interface AcpPermissionPresentationConfig {
  agentName: string;
  /** Enables the workflow/goal cases and the subagent alias for this agent. */
  extendedToolCases?: boolean;
}

export interface AcpPermissionPresentationResult {
  blockedPath?: string;
  decisionReason?: string;
  description: string;
  toolName: string;
}

/**
 * Builds the provider-specific permission presentation mapper. Providers only
 * differ by agent display name and a few extra tool cases.
 */
export function createAcpPermissionPresentation(
  config: AcpPermissionPresentationConfig,
): (
  rawTitle: string | null | undefined,
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
) => AcpPermissionPresentationResult {
  const { agentName, extendedToolCases } = config;

  return (rawTitle, input, locations) => {
    const permissionId = normalizePermissionId(rawTitle);
    const blockedPath = extractPermissionPath(input, locations);

    if (extendedToolCases) {
      switch (permissionId) {
        case 'subagent':
          return {
            description: `${agentName} wants to spawn a subagent.`,
            toolName: 'agent',
          };
        case 'workflow':
          return {
            description: `${agentName} wants to run a workflow across multiple subagents.`,
            toolName: 'workflow',
          };
        case 'goal':
          return {
            description: `${agentName} wants to update the session goal.`,
            toolName: 'goal',
          };
        default:
          break;
      }
    }

    switch (permissionId) {
      case 'bash':
      case 'shell':
      case 'terminal':
        return {
          decisionReason: 'Command execution permission required',
          description: `${agentName} wants to run a shell command.`,
          toolName: 'bash',
        };
      case 'edit':
      case 'editfile':
      case 'write':
      case 'writefile':
        return {
          ...(blockedPath ? { blockedPath } : {}),
          decisionReason: 'File write permission required',
          description: blockedPath
            ? `${agentName} wants to modify this file.`
            : `${agentName} wants to apply file changes.`,
          toolName: 'edit',
        };
      case 'read':
      case 'readfile':
        return {
          ...(blockedPath ? { blockedPath } : {}),
          description: blockedPath
            ? `${agentName} wants to read this path.`
            : `${agentName} wants to read project files.`,
          toolName: 'read',
        };
      case 'glob':
        return {
          description: `${agentName} wants to scan file paths with a glob pattern.`,
          toolName: 'glob',
        };
      case 'grep':
      case 'search':
        return {
          description: `${agentName} wants to search file contents with a pattern.`,
          toolName: 'grep',
        };
      case 'question':
        return {
          description: `${agentName} wants to ask you a direct question before continuing.`,
          toolName: 'Ask Question',
        };
      case 'websearch':
        return {
          description: `${agentName} wants to search the web.`,
          toolName: 'websearch',
        };
      case 'webfetch':
      case 'fetchurl':
        return {
          description: `${agentName} wants to fetch content from a URL.`,
          toolName: 'webfetch',
        };
      case 'todowrite':
        return {
          description: `${agentName} wants to update the shared task list.`,
          toolName: 'todowrite',
        };
      case 'agent':
      case 'task':
        return {
          description: `${agentName} wants to spawn a subagent.`,
          toolName: 'agent',
        };
      case 'skill':
        return {
          description: `${agentName} wants to load a skill into the current session.`,
          toolName: 'skill',
        };
      default:
        return {
          ...(blockedPath ? { blockedPath } : {}),
          description: blockedPath
            ? `${agentName} wants permission to use ${formatPermissionLabel(permissionId)} on this path.`
            : `${agentName} wants permission to use ${formatPermissionLabel(permissionId)}.`,
          toolName: formatPermissionLabel(permissionId),
        };
    }
  };
}

function normalizePermissionId(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || 'tool';
}

function extractPermissionPath(
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): string | undefined {
  const candidateKeys = ['filepath', 'filePath', 'path', 'parentDir', 'file_path'];
  for (const key of candidateKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const locationPath = locations?.find((location) => location.path.trim())?.path;
  return locationPath?.trim() || undefined;
}

function formatPermissionLabel(permissionId: string): string {
  return permissionId
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function normalizeApprovalInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  if (rawInput === undefined) {
    return {};
  }
  return { value: rawInput };
}
