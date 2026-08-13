export interface DshProviderState {
  sessionId?: string;
}

export function getDshState(
  providerState?: Record<string, unknown>,
): DshProviderState {
  return (providerState ?? {});
}
