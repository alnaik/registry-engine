import type { Entity, Evidence } from "../entity.js";
import type { SourceSpec } from "../driver.js";

// Shared row -> canonical Entity mapping, driven entirely by the manifest
// field map. Recognized canonical keys in spec.fields:
//   id, name, status, street, city, state, zip,
//   officer, officer_first, officer_last, officer_org,
//   naics          one or more NAICS codes separated by whitespace/commas;
//                  tokens that aren't 2-6 digits are dropped. Falls back to
//                  quirks.defaultNaics (string[]) when unmapped or empty.
//   employees      headcount, parsed as an integer (>= 0)
//   status         quirks.statusDisplay (string), when set, replaces the raw
//                  field value in entity.status (filters still use the raw field)
//   date           the record's date -> lastSeen; "YYYY-MM-DD..." or
//                  "MM/DD/YYYY", anything else is ignored
//   formedDate     the date the registry says the entity was formed ->
//                  entity.formedDate; parsed like `date`, set only when it parses
//   address_line   single-line "street, city, state, zip"; fills only the
//                  street/city/state/zip keys not mapped on their own
// Any field listed in spec.contact_fields lands in contacts[].
export function rowToEntity(source: SourceSpec, row: Record<string, unknown>): Entity {
  const f = source.fields;
  const get = (key: string): string => {
    const srcField = f[key];
    if (srcField === undefined) return "";
    return str(row[srcField]);
  };

  const officers: string[] = [];
  const officerWhole = get("officer");
  if (officerWhole !== "") officers.push(officerWhole);
  const first = get("officer_first");
  const last = get("officer_last");
  const person = `${first} ${last}`.trim();
  if (person !== "") officers.push(person);
  const org = get("officer_org");
  if (org !== "") officers.push(org);

  const contacts: string[] = [];
  for (const cf of source.contact_fields ?? []) {
    const v = str(row[cf]);
    if (v !== "") contacts.push(v);
  }

  const naicsCodes = get("naics").split(/[\s,]+/).filter(t => /^\d{2,6}$/.test(t));
  const defaults = source.quirks?.["defaultNaics"];
  const naics = naicsCodes.length > 0 ? naicsCodes
    : Array.isArray(defaults) ? defaults.filter((c): c is string => typeof c === "string") : [];

  const employees = parseInt(get("employees"), 10);
  const lastSeen = parseDate(get("date"));
  const line = parseAddressLine(get("address_line"));
  const addr = {
    street: get("street") || line.street || "",
    city: get("city") || line.city || "",
    state: get("state") || line.state || "",
    zip: get("zip") || line.zip || "",
  };

  const entity: Entity = {
    id: `${source.id}:${get("id")}`,
    name: get("name"),
    names: [],
    status: typeof source.quirks?.["statusDisplay"] === "string" ? source.quirks["statusDisplay"] : get("status"),
    address: {
      ...(addr.street !== "" ? { street: addr.street } : {}),
      ...(addr.city !== "" ? { city: addr.city } : {}),
      ...(addr.state !== "" ? { state: addr.state } : {}),
      ...(addr.zip !== "" ? { zip: addr.zip } : {}),
    },
    officers,
    naics,
    contacts,
    source_ids: [source.id],
    evidence: [],
  };
  if (Number.isFinite(employees) && employees >= 0) entity.employees = employees;
  if (lastSeen !== undefined) entity.lastSeen = lastSeen;
  const formedDate = parseDate(get("formedDate"));
  if (formedDate !== undefined) entity.formedDate = formedDate;
  return entity;
}

function parseDate(v: string): string | undefined {
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  if (iso !== null) return iso[1];
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (us !== null) return `${us[3]}-${us[1]}-${us[2]}`;
  return undefined;
}

// "15030 US Highway 50, Las Animas, CO, 81054" -> street/city/state/zip.
// Needs a trailing ZIP to anchor the positions; without one nothing is
// guessed. Registry placeholders ("NO ADDRESS", "NO CITY") are dropped.
function parseAddressLine(v: string): { street?: string; city?: string; state?: string; zip?: string } {
  const parts = v.split(",").map(p => p.trim()).filter(p => p !== "");
  const last = parts.pop();
  if (last === undefined || !/^\d{5}/.test(last)) return {};
  const zip = last.slice(0, 5);
  let state: string | undefined;
  if (parts.length > 0 && /^[A-Z]{2}$/i.test(parts[parts.length - 1]!)) state = parts.pop();
  const city = parts.pop();
  const street = parts.join(", ");
  const real = (p: string | undefined) => (p === undefined || p === "" || /^NO\s/i.test(p) ? undefined : p);
  const out: { street?: string; city?: string; state?: string; zip?: string } = { zip };
  const parsed = { street: real(street), city: real(city), state: real(state) };
  if (parsed.street !== undefined) out.street = parsed.street;
  if (parsed.city !== undefined) out.city = parsed.city;
  if (parsed.state !== undefined) out.state = parsed.state;
  return out;
}

// Raw values of the manifest's quirks.evidenceFields, one Evidence each, so
// a brief can quote what the registry itself says (crop lists, business type).
export function fieldEvidence(source: SourceSpec, row: Record<string, unknown>): Evidence[] {
  const names = source.quirks?.["evidenceFields"];
  if (!Array.isArray(names)) return [];
  const out: Evidence[] = [];
  for (const field of names) {
    if (typeof field !== "string") continue;
    const value = str(row[field]).trim().slice(0, 200);
    if (value !== "") out.push({ source: source.id, field, value });
  }
  return out;
}

// A hit at a word start ("JEWEL" in "GLAMLY JEWELRY") is real signal; a hit
// buried mid-word ("GEM" in "MANAGEMENT") is substring noise — the note
// records the difference and ranking weights them apart.
export function keywordEvidence(
  source: SourceSpec,
  field: string,
  value: string,
  keywords: string[]
): Evidence[] {
  const upper = value.toUpperCase();
  for (const kw of keywords) {
    const k = kw.toUpperCase();
    if (!upper.includes(k)) continue;
    const atWordStart = new RegExp(`(?:^|[^A-Z0-9])${k.replace(/[^A-Z0-9]/g, "")}`).test(upper);
    return [{
      source: source.id, field, value,
      note: atWordStart ? `matched "${kw.toLowerCase()}"` : `matched "${kw.toLowerCase()}" inside a word`,
    }];
  }
  return [];
}

export function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}
