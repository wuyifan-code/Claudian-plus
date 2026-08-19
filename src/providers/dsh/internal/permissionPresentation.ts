import { createAcpPermissionPresentation, normalizeApprovalInput } from '../../acp/permissionPresentation';

export { normalizeApprovalInput };

export const buildDshPermissionPresentation = createAcpPermissionPresentation({
  agentName: 'DeepSeek',
  extendedToolCases: true,
});
