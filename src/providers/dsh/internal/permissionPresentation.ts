export function buildDshPermissionPresentation(
  rawTitle: string | null | undefined,
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): {
  blockedPath?: string;
  decisionReason?: string;
  description: string;
  toolName: string;
} {
  const permissionId = normalizePermissionId(rawTitle);
  const blockedPath = extractPermissionPath(input, locations);

  switch (permissionId) {
    case 'bash':
    case 'shell':
    case 'terminal':
      return {
        decisionReason: 'Command execution permission required',
        description: 'DeepSeek wants to run a shell command.',
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
          ? 'DeepSeek wants to modify this file.'
          : 'DeepSeek wants to apply file changes.',
        toolName: 'edit',
      };
    case 'read':
    case 'readfile':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? 'DeepSeek wants to read this path.'
          : 'DeepSeek wants to read project files.',
        toolName: 'read',
      };
    case 'glob':
      return {
        description: 'DeepSeek wants to scan file paths with a glob pattern.',
        toolName: 'glob',
      };
    case 'grep':
    case 'search':
      return {
        description: 'DeepSeek wants to search file contents with a pattern.',
        toolName: 'grep',
      };
    case 'question':
      return {
        description: 'DeepSeek wants to ask you a direct question before continuing.',
        toolName: 'Ask Question',
      };
    case 'websearch':
      return {
        description: 'DeepSeek wants to search the web.',
        toolName: 'websearch',
      };
    case 'webfetch':
    case 'fetchurl':
      return {
        description: 'DeepSeek wants to fetch content from a URL.',
        toolName: 'webfetch',
      };
    case 'todowrite':
      return {
        description: 'DeepSeek wants to update the shared task list.',
        toolName: 'todowrite',
      };
    case 'agent':
    case 'task':
    case 'subagent':
      return {
        description: 'DeepSeek wants to spawn a subagent.',
        toolName: 'agent',
      };
    case 'skill':
      return {
        description: 'DeepSeek wants to load a skill into the current session.',
        toolName: 'skill',
      };
    case 'workflow':
      return {
        description: 'DeepSeek wants to run a workflow across multiple subagents.',
        toolName: 'workflow',
      };
    case 'goal':
      return {
        description: 'DeepSeek wants to update the session goal.',
        toolName: 'goal',
      };
    default:
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? `DeepSeek wants permission to use ${formatPermissionLabel(permissionId)} on this path.`
          : `DeepSeek wants permission to use ${formatPermissionLabel(permissionId)}.`,
        toolName: formatPermissionLabel(permissionId),
      };
  }
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
