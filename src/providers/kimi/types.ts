export interface KimiProviderState {
  sessionId?: string;
}

export function getKimiState(
  providerState?: Record<string, unknown>,
): KimiProviderState {
  return (providerState ?? {});
}
