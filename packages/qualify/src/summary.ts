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
  coded: number;            // leads with an industry code related to the request
  nameOnly: number;         // the rest: name matches only
  individuals: number;      // coded leads that are an individual's record
  withinRadius: number | null;   // coded leads within radiusMi of the origin; null = no origin
  radiusMi: number;
  confirmed: number;        // coded leads matched on the state registry
  withPhone: number;        // coded leads with a published phone
}

// Counts for the web app's one-sentence summary. Everything is over coded
// leads: name-only matches never enter the headline.
export function sheetCounts(ranked: Lead[], mapCodes: string[], opts: { radiusMi: number; hasOrigin: boolean; isIndividual: (l: Lead) => boolean }): SheetCounts {
  const coded = ranked.filter(l => l.entity.naics.some(e => mapCodes.some(q => naicsRelated(e, q))));
  return {
    total: ranked.length,
    coded: coded.length,
    nameOnly: ranked.length - coded.length,
    individuals: coded.filter(opts.isIndividual).length,
    withinRadius: opts.hasOrigin ? coded.filter(l => l.distanceMi !== null && l.distanceMi <= opts.radiusMi).length : null,
    radiusMi: opts.radiusMi,
    confirmed: coded.filter(l => l.registryCheck === "matched").length,
    withPhone: coded.filter(hasPhone).length,
  };
}
