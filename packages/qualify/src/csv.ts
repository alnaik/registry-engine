import { naicsLabel } from "@registry-engine/registry-core";
import type { Lead } from "./verbs/brief.js";
import { isLikelyIndividual } from "./verbs/contacts.js";

// CSV export of every ranked lead. Every cell is double-quoted. Registry
// names are attacker-controllable text that ends up in a spreadsheet, so a
// cell that would be read as a formula gets a leading apostrophe.

export const CSV_HEADER = [
  "rank", "score", "name", "other_names", "street", "city", "state", "zip",
  "naics", "naics_titles", "employees", "last_seen", "sources", "on_state_registry", "registry_check",
  "contacts", "web", "search_url", "officers", "brief", "opener",
  "distance_mi", "band", "found_status", "found_phone", "found_email", "found_website", "found_sources",
  "individual_record",
] as const;

export function csvCell(value: string | number | undefined): string {
  let text = value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function leadsToCsv(leads: Lead[], existenceIds: string[]): string {
  const rows = leads.map((lead, i) => {
    const e = lead.entity;
    return [
      i + 1,
      lead.score,
      e.name,
      e.names.join("; "),
      e.address.street,
      e.address.city,
      e.address.state,
      e.address.zip,
      e.naics.join("; "),
      e.naics.map(c => naicsLabel(c) ?? "").join("; "),
      e.employees,
      e.lastSeen,
      e.source_ids.join("; "),
      e.source_ids.some(id => existenceIds.includes(id)) ? "yes" : "no",
      lead.registryCheck ?? "",
      e.contacts.join("; "),
      lead.web,
      lead.searchUrl ?? "",
      e.officers.join("; "),
      lead.brief,
      lead.opener,
      lead.distanceMi ?? "",
      lead.band,
      lead.found?.status ?? "",
      lead.found?.phone,
      lead.found?.email,
      lead.found?.website,
      lead.found?.sourceUrls.join("; ") ?? "",
      isLikelyIndividual(e) ? "yes" : "no",
    ].map(csvCell).join(",");
  });
  return [CSV_HEADER.map(csvCell).join(","), ...rows].join("\n") + "\n";
}
