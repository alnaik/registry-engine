import type { Entity } from "./entity.js";
import type { FetchRetryOptions } from "./util/http.js";

// The three planes a source can serve. The category plane is sources whose
// records carry what a business does (a license class or an industry code) —
// never per-candidate LLM verification.
export type Plane = "existence" | "category" | "contact";

export type DriverKind = "socrata" | "rest" | "static_shard" | "echo";

// One manifest entry per government registry. Adding a source or a state
// must require zero code changes — only a config entry.
export interface SourceSpec {
  id: string;                      // "co_sos", "paca"
  name: string;                    // human label for briefs/evidence
  plane: Plane;
  driver: DriverKind;
  coverage: {
    geo: string[];                 // region codes: "US" or "US-CO"
    naics: string[];               // NAICS codes/prefixes the source carries; ["*"] = any
  };
  endpoint: string;                // base URL ("" allowed for static_shard stubs)
  fields: Record<string, string>;  // canonical field -> source field
  contact_fields?: string[] | undefined;   // source fields that yield contacts[]
  quirks?: Record<string, unknown> | undefined;  // per-source oddities the driver reads
}

// What map(query) produces and route(intent) consumes.
export interface Intent {
  naics: string[];                 // NAICS codes/prefixes of the leads, e.g. ["424480"]
  geo: { region: string; cities: string[] };  // cities empty = whole region
  direction: "buy" | "sell";       // is the user buying from or selling to the leads
}

export interface FetchRequest {
  keywords: string[];   // fragments matched against names / descriptions
  region: string;       // "US-CO" — picks shard files, scopes contact probes
  cities: string[];     // geo filter within the region; empty = whole region
  naics: string[];      // NAICS codes/prefixes, for category-plane sources
  limit?: number | undefined;
}

export interface RecentRequest {
  keywords: string[];
  since: string;        // YYYY-MM-DD, inclusive
  limit?: number | undefined;
}

// A driver is generic over sources: the same socrata driver serves CO today
// and CT/WA/NY later, differing only by SourceSpec.
export interface Driver {
  readonly kind: DriverKind;
  fetch(source: SourceSpec, req: FetchRequest, opts?: FetchRetryOptions): Promise<Entity[]>;
  // Targeted existence lookup: fetch records whose name matches one of the
  // given business names. Used to backfill the existence join for entities
  // discovered on other planes. Optional — drivers without it are skipped.
  fetchByNames?(source: SourceSpec, names: string[], opts?: FetchRetryOptions): Promise<Entity[]>;
  // Entities formed on or after `since` (YYYY-MM-DD) whose name matches a
  // keyword, newest first. Optional — needs a formedDate field in the manifest.
  fetchRecent?(source: SourceSpec, req: RecentRequest, opts?: FetchRetryOptions): Promise<Entity[]>;
}

export type DriverRegistry = Partial<Record<DriverKind, Driver>>;
