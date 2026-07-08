import type { NormalizedEntity, LocationQuery, EntityFilters } from "../types.js";

// The one abstraction that makes this scale to other states: implement this
// interface + a field-constants file + a script-generated zip-centroid table,
// and everything downstream (triage, verify, brief, UI) works unchanged.
export interface RegistrySource {
  readonly id: string;
  readonly state: string;

  // Stream every entity in the area (no keyword filter). Used by the CLI
  // `entities` command; expensive over large areas.
  fetchEntities(
    query: LocationQuery,
    filters?: EntityFilters
  ): AsyncIterable<NormalizedEntity>;

  // Server-side keyword search over entity names + trade-name descriptions.
  // This is the product's primary entry point: only candidate rows ever
  // leave the registry API.
  searchEntities(
    query: LocationQuery,
    keywords: string[],
    filters?: EntityFilters
  ): AsyncIterable<NormalizedEntity>;
}
