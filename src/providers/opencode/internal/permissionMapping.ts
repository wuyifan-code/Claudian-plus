import type { ApprovalDecisionOption } from '../../../core/runtime/types';
import type { ApprovalDecision } from '../../../core/types';
import type {
  AcpPermissionOption,
  AcpRequestPermissionResponse,
} from '../../acp';

export function mapApprovalDecision(
  decision: ApprovalDecision,
  options: readonly AcpPermissionOption[],
): AcpRequestPermissionResponse {
  if (decision === 'allow') {
    return selectPermissionOption(options, ['allow_once', 'allow_always']);
  }

  if (decision === 'allow-always') {
    return selectPermissionOption(options, ['allow_always', 'allow_once']);
  }

  if (decision === 'deny') {
    return selectPermissionOption(options, ['reject_once', 'reject_always']);
  }

  if (typeof decision === 'object' && decision.type === 'select-option') {
    const option = options.find((entry) => entry.optionId === decision.value);
    return option ? selectedResponse(option) : CANCELLED_RESPONSE;
  }

  return CANCELLED_RESPONSE;
}

export function buildAcpApprovalDecisionOptions(
  options: readonly AcpPermissionOption[],
): ApprovalDecisionOption[] {
  return options.map((option) => ({
    ...(option.kind === 'allow_once'
      ? { decision: 'allow' as const }
      : option.kind === 'allow_always'
      ? { decision: 'allow-always' as const }
      : {}),
    label: option.name,
    value: option.optionId,
  }));
}

export function selectPermissionOption(
  options: readonly AcpPermissionOption[],
  preferredKinds: readonly AcpPermissionOption['kind'][],
): AcpRequestPermissionResponse {
  for (const kind of preferredKinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) {
      return selectedResponse(option);
    }
  }

  return CANCELLED_RESPONSE;
}

const CANCELLED_RESPONSE: AcpRequestPermissionResponse = {
  outcome: { outcome: 'cancelled' },
};

function selectedResponse(option: AcpPermissionOption): AcpRequestPermissionResponse {
  return {
    outcome: {
      optionId: option.optionId,
      outcome: 'selected',
    },
  };
}
