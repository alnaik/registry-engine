export interface KVCache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export class MemoryCache implements KVCache {
  private store = new Map<string, unknown>();
  get(key: string): unknown { return this.store.get(key); }
  set(key: string, value: unknown): void { this.store.set(key, value); }
}

// WindowStorageCache implemented in apps/artifact (needs window.storage) — not here
