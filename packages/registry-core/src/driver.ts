import type { Entity } from "./entity.js";
import type { FetchRetryOptions } from "./util/http.js";

// The three planes a source can serve. Category membership comes from
// federal registries whose category signal is inherent to the registry
// (a PACA license IS produce) — never from per-candidate LLM verification.
export type Plane = "existence" | "category" | "contact";

export type DriverKind = "socrata" | "rest" | "static_shard";

// One manifest entry per government registry. Adding a source or a state
// must require zero code changes — only a config entry.
export interface SourceSpec {
  id: string;                      // "co_sos", "paca"
  name: string;                    // human label for briefs/evidence
  plane: Plane;
  driver: DriverKind;
  coverage: {
    geo: string[];                 // region codes: "US" or "US-CO"
    categories: string[];          // canonical slugs; ["*"] = all (existence plane)
  };
  endpoint: string;                // base URL ("" allowed for static_shard stubs)
  fields: Record<string, string>;  // canonical field -> source field
  contact_fields?: string[] | undefined;   // source fields that yield contacts[]
  quirks?: Record<string, unknown> | undefined;  // per-source oddities the driver reads
}

// What map(query) produces and route(intent) consumes.
export interface Intent {
  categories: string[];            // canonical slugs, e.g. ["produce"]
  geo: { region: string; cities: string[] };  // cities empty = whole region
  direction: "buy" | "sell";       // is the user buying from or selling to the leads
}

export interface FetchRequest {
  keywords: string[];   // fragments matched against names / descriptions
  cities: string[];     // geo filter; empty = whole coverage geo
  categories: string[]; // canonical slugs, for category-plane sources
  limit?: number | undefined;
}

// A driver is generic over sources: the same socrata driver serves CO today
// and CT/WA/NY later, differing only by SourceSpec.
export interface Driver {
  readonly kind: DriverKind;
  fetch(source: SourceSpec, req: FetchRequest, opts?: FetchRetryOptions): Promise<Entity[]>;
}

export type DriverRegistry = Partial<Record<DriverKind, Driver>>;
