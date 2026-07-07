# ADR 0002 — TypeScript Strict Mode Everywhere

**Status:** Accepted

## Context

The engine processes government data with no fixed schema guarantees. A field that exists today may be absent tomorrow (schema drift). Null/undefined errors in a running artifact that a user can't reload are worse than a compile-time failure caught during development.

## Options Considered

1. **TypeScript strict mode** (`strict: true` plus `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
2. **TypeScript without strict** — fewer type errors upfront, but more runtime surprises.
3. **JavaScript** — faster scaffolding, but loses the compiler as a schema-drift detector.

## Decision

TypeScript strict mode (option 1). `noUncheckedIndexedAccess` is particularly valuable here: it forces explicit null checks when indexing arrays, which is common when parsing Socrata rows. `exactOptionalPropertyTypes` prevents accidentally treating `undefined` as an explicit value in optional fields.

## Consequences

- Initial code is more verbose (explicit null checks, type assertions at API boundaries).
- Schema-constants pattern (ADR 0007) integrates naturally: field names are typed string literals, so a rename in the constants file produces a compile error at every usage site.
- The artifact (.jsx) is exempt from TypeScript strict checking — it's compiled to JS by esbuild — but the packages it imports are fully typed.
