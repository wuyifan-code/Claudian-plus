import { createAcpPermissionPresentation, normalizeApprovalInput } from '../../acp/permissionPresentation';

export { normalizeApprovalInput };

export const buildKimiPermissionPresentation = createAcpPermissionPresentation({
  agentName: 'Kimi',
});
