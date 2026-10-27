import { naicsRelated } from "@registry-engine/registry-core";
import type { Lead } from "./verbs/brief.js";

// The honest headline for a search: how many leads rest on an industry code
// versus a name match alone, and how many have no website in the records.
export function summaryCounts(ranked: Lead[], mapCodes: string[]): { total: number; coded: number; nameOnly: number; noWebsite: number } {
  const coded = ranked.filter(l => l.entity.naics.some(e => mapCodes.some(q => naicsRelated(e, q)))).length;
  const noWebsite = ranked.filter(l => l.web === "none").length;
  return { total: ranked.length, coded, nameOnly: ranked.length - coded, noWebsite };
}

export function summaryLines(ranked: Lead[], mapCodes: string[]): string[] {
  const { total, coded, nameOnly, noWebsite } = summaryCounts(ranked, mapCodes);
  const lines = [
    `Found ${coded} businesses with an industry code for this request${nameOnly > 0 ? ` (+${nameOnly} name matches, lower confidence)` : ""}`,
  ];
  // Says nothing when it is true of every lead.
  if (noWebsite < total) lines.push(`${noWebsite} have no website listed in the records searched — business records get a search link.`);
  return lines;
}
