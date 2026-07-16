import type { Entity, Evidence } from "../entity.js";
import type { SourceSpec } from "../driver.js";

// Shared row -> canonical Entity mapping, driven entirely by the manifest
// field map. Recognized canonical keys in spec.fields:
//   id, name, status, street, city, state, zip,
//   officer, officer_first, officer_last, officer_org
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

  const categories = source.coverage.categories.filter(c => c !== "*");

  return {
    id: `${source.id}:${get("id")}`,
    name: get("name"),
    names: [],
    status: get("status"),
    address: {
      ...(get("street") !== "" ? { street: get("street") } : {}),
      ...(get("city") !== "" ? { city: get("city") } : {}),
      ...(get("state") !== "" ? { state: get("state") } : {}),
      ...(get("zip") !== "" ? { zip: get("zip") } : {}),
    },
    officers,
    categories,
    contacts,
    source_ids: [source.id],
    evidence: [],
  };
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
