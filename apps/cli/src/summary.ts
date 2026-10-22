import { naicsRelated } from "@registry-engine/registry-core";
import type { Lead } from "@registry-engine/qualify";

// The honest headline for a search: how many leads rest on an industry code
// versus a name match alone, and how many have no website in the records.
export function summaryLines(ranked: Lead[], mapCodes: string[]): string[] {
  const coded = ranked.filter(l => l.entity.naics.some(e => mapCodes.some(q => naicsRelated(e, q)))).length;
  const noSite = ranked.filter(l => l.web === "none").length;
  return [
    `Found ${ranked.length} businesses: ${coded} with an industry code for this request, ${ranked.length - coded} name matches only (lower confidence).`,
    `${noSite} have no website listed in the records searched — each has a search link.`,
  ];
}
