import type { SourceSpec } from "./driver.js";
import { geoCovers } from "./route.js";

// Region-level codes a source contributes: entries of coverage.geo that
// contain "-" (bare country codes like "US" are coverage, not selectable
// regions), plus any region codes named in quirks.shardRegions (a
// static_shard source's geo is often the whole country, with the actual
// per-region split recorded in quirks instead).
export function knownRegions(sources: SourceSpec[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    for (const g of s.coverage.geo) {
      if (g.includes("-") && !out.includes(g)) out.push(g);
    }
    const shardRegions = s.quirks?.["shardRegions"];
    if (Array.isArray(shardRegions) && shardRegions.every(r => typeof r === "string")) {
      for (const g of shardRegions) {
        if (g.includes("-") && !out.includes(g)) out.push(g);
      }
    }
  }
  return out;
}

// The region a bare `search()` call picks when the caller doesn't name one:
// the first region-level code among existence-plane sources (the ones that
// anchor a search), falling back to any source if no existence source
// carries a region.
export function defaultRegion(sources: SourceSpec[]): string {
  const existenceRegions = knownRegions(sources.filter(s => s.plane === "existence"));
  const region = existenceRegions[0] ?? knownRegions(sources)[0];
  if (region === undefined) throw new Error("no region-level coverage in manifest");
  return region;
}

// City names a region's sources know about, lowercased and deduped. A
// source contributes its quirks.cities when its coverage (via geoCovers,
// so "US" covers "US-CO") or its quirks.shardRegions names this region.
export function regionCities(sources: SourceSpec[], region: string): string[] {
  const out: string[] = [];
  for (const s of sources) {
    const shardRegions = s.quirks?.["shardRegions"];
    const shardMatch = Array.isArray(shardRegions) && shardRegions.every(r => typeof r === "string") && shardRegions.includes(region);
    if (!geoCovers(s.coverage.geo, region) && !shardMatch) continue;
    const cities = s.quirks?.["cities"];
    if (Array.isArray(cities) && cities.every(c => typeof c === "string")) {
      for (const c of cities) {
        const lower = c.toLowerCase();
        if (!out.includes(lower)) out.push(lower);
      }
    }
  }
  return out;
}
