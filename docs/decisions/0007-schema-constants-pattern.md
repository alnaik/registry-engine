# ADR 0007 — Schema Constants Pattern for Socrata Field Names

**Status:** Accepted

## Context

Colorado's Socrata datasets have field names that are sometimes misspelled (`jurisdictonofformation`), inconsistently named across datasets (`recordstatuscode` in debtors vs `recordstatuscd` in secured parties), or could change between dataset updates. Government schemas drift. Spreading field name strings throughout the codebase means a schema change requires a global find-and-replace.

## Options Considered

1. **Inline string literals** — fast to write, fragile to schema changes.
2. **One shared constants object** — better than inline, but mixing field names from different datasets in one file creates confusion.
3. **Per-dataset constants file** — each dataset gets a `FIELDS` object and a `STATUS` object in its own file. The adapters import from their own constants file only.

## Decision

Option 3. Each dataset directory contains a `fields.ts` file that exports all field names and known enum values as typed string constants:

```typescript
// Example: packages/registry-core/src/sources/colorado/entityFields.ts
export const ENTITY_FIELDS = {
  id: "entityid",
  name: "entityname",
  status: "entitystatus",
  zipcode: "principalzipcode",
  formDate: "entityformdate",
  // ... etc
} as const;

export const ENTITY_STATUS = {
  goodStanding: "Good Standing",
  delinquent: "Delinquent",
} as const;
```

A schema change is then a one-line fix in `fields.ts`, and TypeScript flags every downstream usage automatically.

## Consequences

- Slightly more ceremony to add a new field (update constants, then use constant).
- The fixture sanity tests implicitly validate the constants: if a field name changes in the live data, the fixture test catches it before the constants file is updated.
- Each dataset's quirks (e.g., the `entitystatus` value mismatch between entities and trade names) are localized to their constants file and its inline comment, not scattered across adapter code.
