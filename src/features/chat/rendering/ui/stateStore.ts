/**
 * Per-widget interaction state, deliberately kept outside the DOM.
 *
 * The message list evicts nodes beyond MAX_WINDOW_SIZE and the streaming
 * renderer rebuilds a text block on every frame, so any state living in an
 * element would be lost on scroll or on the next frame.
 */
export class UiStateStore {
  private readonly values = new Map<string, unknown>();
  private readonly claims = new Map<string, string>();
  private readonly listeners = new Set<(scope: string) => void>();

  get(scope: string, name: string): unknown {
    return this.values.get(`${scope}:${name}`);
  }

  has(scope: string, name: string): boolean {
    return this.values.has(`${scope}:${name}`);
  }

  set(scope: string, name: string, value: unknown): void {
    const key = `${scope}:${name}`;
    const previous = this.values.get(key);
    if (Object.is(previous, value)) return;
    this.values.set(key, value);
    for (const listener of this.listeners) listener(scope);
  }

  /**
   * Registers which conversation owns a scope's persisted state
   * (`blockKey -> conversationId`). Last claim wins; re-renders re-claim.
   */
  claim(scope: string, ownerId: string): void {
    this.claims.set(scope, ownerId);
  }

  /** Snapshot of the scope's current values; undefined values are excluded. */
  scopeEntries(scope: string): Record<string, unknown> {
    const entries: Record<string, unknown> = {};
    const prefix = `${scope}:`;
    for (const [key, value] of this.values) {
      if (!key.startsWith(prefix) || value === undefined) continue;
      entries[key.slice(prefix.length)] = value;
    }
    return entries;
  }

  /** Scopes currently claimed by `ownerId`. */
  scopesOf(ownerId: string): string[] {
    const scopes: string[] = [];
    for (const [scope, owner] of this.claims) {
      if (owner === ownerId) scopes.push(scope);
    }
    return scopes;
  }

  /** Drops state for a scope whose program changed shape and can no longer reuse it. */
  clearScope(scope: string): void {
    const prefix = `${scope}:`;
    let removed = false;
    for (const key of [...this.values.keys()]) {
      if (key.startsWith(prefix)) {
        this.values.delete(key);
        removed = true;
      }
    }
    this.claims.delete(scope);
    if (removed) {
      for (const listener of this.listeners) listener(scope);
    }
  }

  subscribe(listener: (scope: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Shared store: widget state outlives individual render passes. */
export const uiStateStore = new UiStateStore();
