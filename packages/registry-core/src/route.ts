import type { Intent, SourceSpec } from "./driver.js";

// route() is a pure table lookup over the manifest: which sources natively
// carry this category in this geo. Zero tokens, zero network.
export function route(intent: Intent, sources: SourceSpec[]): SourceSpec[] {
  return sources.filter(s =>
    geoCovers(s.coverage.geo, intent.geo.region) &&
    categoryCovers(s.coverage.categories, intent.categories)
  );
}

// "US" covers "US-CO"; "US-CO" covers only itself.
export function geoCovers(coverage: string[], region: string): boolean {
  return coverage.some(g => g === region || region.startsWith(`${g}-`));
}

// ["*"] (existence/contact planes) matches any query; otherwise the source
// fires only when it natively carries one of the query's categories.
function categoryCovers(coverage: string[], categories: string[]): boolean {
  if (coverage.includes("*")) return true;
  return categories.some(c => coverage.includes(c));
}
