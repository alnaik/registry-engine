import { naicsRelated } from "@registry-engine/registry-core";
import type { Lead } from "./verbs/brief.js";
import { isLikelyIndividual } from "./verbs/contacts.js";

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

const PHONE_LIKE = /^\+?[\d\s().-]{7,}(?:\s*(?:x|ext\.?)\s*\d+)?$/i;

// A phone a registry published, or one found on the business's own pages
// (labelled "verify" wherever it is shown).
export function hasPhone(lead: Lead): boolean {
  const isPhone = (v: string): boolean => {
    const digits = v.replace(/\D/g, "");
    return PHONE_LIKE.test(v.trim()) && digits.length >= 10 && digits.length <= 11;
  };
  return lead.entity.contacts.some(isPhone) || (lead.found?.phone !== undefined && lead.found.phone !== "");
}

export interface SheetCounts {
  total: number;
  coded: number;            // leads with an industry code related to the request (businesses + individuals)
  businesses: number;       // coded leads that are not an individual's record: the sheet's rows
  listed: number;           // business rows the sheet actually lists (businesses, cut to the list cap)
  nameOnly: number;         // the rest: name matches only
  individuals: number;      // coded leads that are an individual's record (listed separately)
  withinRadius: number | null;   // businesses within radiusMi of the origin; null = no origin
  radiusMi: number;
  confirmed: number;        // businesses matched on the state registry
  withPhone: number;        // businesses with a published phone
}

// The one split every surface uses: coded businesses (the sheet's rows),
// coded individuals' records (a trailing group, shown as filed), and
// name-only matches (never in the headline). Order is the ranking's.
export function partitionLeads(ranked: Lead[], mapCodes: string[]): { businesses: Lead[]; individuals: Lead[]; nameOnly: Lead[] } {
  const out = { businesses: [] as Lead[], individuals: [] as Lead[], nameOnly: [] as Lead[] };
  for (const l of ranked) {
    if (!l.entity.naics.some(e => mapCodes.some(q => naicsRelated(e, q)))) out.nameOnly.push(l);
    else if (isLikelyIndividual(l.entity)) out.individuals.push(l);
    else out.businesses.push(l);
  }
  return out;
}

// Counts for the web app's one-sentence summary and filter chips. Every
// count is over the same rows the sheet lists (coded businesses), so the
// sentence and the chips can't disagree; individuals' records are counted
// separately and name-only matches never enter the headline.
export function sheetCounts(ranked: Lead[], mapCodes: string[], opts: { radiusMi: number; hasOrigin: boolean; listCap?: number | undefined }): SheetCounts {
  const { businesses, individuals, nameOnly } = partitionLeads(ranked, mapCodes);
  return {
    total: ranked.length,
    coded: businesses.length + individuals.length,
    businesses: businesses.length,
    listed: Math.min(businesses.length, opts.listCap ?? Infinity),
    nameOnly: nameOnly.length,
    individuals: individuals.length,
    withinRadius: opts.hasOrigin ? businesses.filter(l => l.distanceMi !== null && l.distanceMi <= opts.radiusMi).length : null,
    radiusMi: opts.radiusMi,
    confirmed: businesses.filter(l => l.registryCheck === "matched").length,
    withPhone: businesses.filter(hasPhone).length,
  };
}
