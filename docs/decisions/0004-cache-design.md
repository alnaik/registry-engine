# ADR 0004 — Two-Layer Cache: Memory + window.storage

**Status:** Accepted

## Context

The biggest real-world token cost is re-running a search with minor parameter changes ("same profile, different zip"). The classify and qualify stages are deterministic for a given (entityId, profileId, profileVersion) triple. Caching their results eliminates the cost of re-running unchanged work.

Two storage contexts: the artifact runs in a browser (no filesystem, limited storage), the CLI runs in Node (filesystem available).

## Options Considered

1. **In-memory only** — results lost on page reload; no cross-session savings.
2. **window.storage only** — only works in the artifact; CLI can't use it.
3. **Pluggable KV interface: memory + window.storage implementations** — the engine code uses the interface; the caller injects the implementation.

## Decision

Option 3. The `cache.ts` module exports a `KVCache` interface with `get(key)` and `set(key, value)` methods. Two implementations: `MemoryCache` (plain Map, works anywhere) and `WindowStorageCache` (uses the artifact's `window.storage` API). The artifact injects `WindowStorageCache`; the CLI injects `MemoryCache` (future: a filesystem cache).

Cache key: `sha256(entityId + "|" + profileId + "|" + profileVersion + "|" + stage)`. The profile version is a string incremented on any profile edit, so changing the criteria invalidates all cached results for that profile.

## Consequences

- `window.storage` has a per-key 5MB limit (artifact platform constraint). Large result sets are sharded by search ID: key = `qualify:${searchId}:${entityId}`.
- All storage ops are wrapped in try/catch; storage failures fall through to in-memory silently (spec requirement — storage must not break the product).
- The CLI's MemoryCache does not persist across runs. A filesystem cache implementation can be added later without changing the engine code.
