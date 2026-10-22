import type { Intent, SourceSpec } from "./driver.js";
import { naicsRelated } from "./naics.js";

// route() is a pure table lookup over the manifest: which sources natively
// carry this industry (NAICS code) in this geo. Zero tokens, zero network.
export function route(intent: Intent, sources: SourceSpec[]): SourceSpec[] {
  return sources.filter(s =>
    geoCovers(s.coverage.geo, intent.geo.region) &&
    naicsCovers(s.coverage.naics, intent.naics)
  );
}

// "US" covers "US-CO"; "US-CO" covers only itself.
export function geoCovers(coverage: string[], region: string): boolean {
  return coverage.some(g => g === region || region.startsWith(`${g}-`));
}

// ["*"] (existence planes, and sources that filter by code themselves)
// matches any query, including one with no codes; otherwise the source fires
// when one of its codes is a prefix of (or prefixed by) a query code, so a
// "4244" source serves "424480" and a "332" query reaches "332312" records.
function naicsCovers(coverage: string[], naics: string[]): boolean {
  if (coverage.includes("*")) return true;
  return naics.some(q => coverage.some(c => naicsRelated(q, c)));
}
