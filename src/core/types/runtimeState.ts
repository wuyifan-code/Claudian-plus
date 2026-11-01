/**
 * Synchronous key/value view over the plugin's persisted runtime state.
 *
 * The contract lives in `core` because feature code reaches it through
 * `FeatureHost`; `app/settings/runtimeState.ts` owns the settings-backed
 * implementation. Keeping the interface here is what lets the boundary check
 * hold: features depend on core contracts, never on app adapters.
 */
export interface RuntimeStateStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}
