// The canonical schema every driver normalizes into. All planes (existence,
// category, contact) join on this shape; merge key is the normalized name.

export interface EntityAddress {
  street?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  zip?: string | undefined;
}

// Why a record matched: which source said what. Every merged Entity carries
// the raw field values that put it in the result set.
export interface Evidence {
  source: string;   // manifest source id, e.g. "co_sos"
  field: string;    // source-side field name
  value: string;
  note?: string | undefined;
}

export interface Entity {
  id: string;             // "<source_id>:<record_id>" of the first contributing source
  name: string;
  names: string[];        // trade names / DBAs / aliases, excluding `name`
  status: string;
  address: EntityAddress;
  officers: string[];     // registered agents, principals, license POCs
  naics: string[];        // NAICS codes the sources attribute to this business
  contacts: string[];     // emails / phones / urls, from contact-plane fields
  source_ids: string[];   // every manifest source that contributed
  evidence: Evidence[];
  employees?: number | undefined;   // largest headcount any source reported
  lastSeen?: string | undefined;    // ISO YYYY-MM-DD, most recent dated record
  formedDate?: string | undefined;  // ISO YYYY-MM-DD the registry says the entity was formed
}

// Trailing org-form tokens stripped before comparing names. Repeated pops
// handle "ACME HOLDINGS CO LLC" -> "ACME HOLDINGS".
export const ORG_SUFFIXES = new Set([
  "LLC", "LC", "INC", "INCORPORATED", "CORP", "CORPORATION",
  "LTD", "LIMITED", "CO", "COMPANY", "LLP", "LP", "PLLC", "PC", "PLC",
]);

export function normalizeName(raw: string): string {
  const tokens = raw
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[.']/g, "")            // dotted abbreviations join: L.L.C. -> LLC
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && ORG_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(" ");
}

// Two same-named records only describe one business if they could be in the
// same place: a record with no city and no zip can't contradict anything;
// otherwise the zips (first 5) or the cities must agree. Keeps two
// "GREEN VALLEY FARMS LLC" in different towns apart.
export function localityCompatible(a: Entity, b: Entity): boolean {
  const aCity = (a.address.city ?? "").trim();
  const bCity = (b.address.city ?? "").trim();
  const aZip = (a.address.zip ?? "").trim();
  const bZip = (b.address.zip ?? "").trim();
  if ((aCity === "" && aZip === "") || (bCity === "" && bZip === "")) return true;
  if (aZip !== "" && bZip !== "" && aZip.slice(0, 5) === bZip.slice(0, 5)) return true;
  if (aCity !== "" && bCity !== "" && aCity.toLowerCase() === bCity.toLowerCase()) return true;
  return false;
}

// Merge records from different sources that are the same business: two
// entities join if ANY of their normalized names (primary or alias) collide
// AND their localities are compatible. Order matters for display fields: feed
// existence-plane results first so the legal name and status win.
export function mergeEntities(entities: Entity[]): Entity[] {
  const groups: Entity[] = [];
  const keyToGroups = new Map<string, number[]>();

  for (const e of entities) {
    const keys = [e.name, ...e.names].map(normalizeName).filter(k => k.length > 0);
    let gi: number | undefined;
    search: for (const k of keys) {
      for (const candidate of keyToGroups.get(k) ?? []) {
        if (localityCompatible(groups[candidate]!, e)) { gi = candidate; break search; }
      }
    }
    if (gi === undefined) {
      gi = groups.length;
      groups.push(cloneEntity(e));
    } else {
      mergeInto(groups[gi]!, e);
    }
    for (const k of keys) {
      const list = keyToGroups.get(k) ?? [];
      if (!list.includes(gi)) list.push(gi);
      keyToGroups.set(k, list);
    }
  }
  return groups;
}

function cloneEntity(e: Entity): Entity {
  return {
    ...e,
    names: dedupeNames(e.name, e.names),
    address: { ...e.address },
    officers: [...e.officers],
    naics: [...e.naics],
    contacts: [...e.contacts],
    source_ids: [...e.source_ids],
    evidence: [...e.evidence],
  };
}

function mergeInto(target: Entity, e: Entity): void {
  target.names = dedupeNames(target.name, [...target.names, e.name, ...e.names]);
  if (target.status === "") target.status = e.status;
  for (const key of ["street", "city", "state", "zip"] as const) {
    if (target.address[key] === undefined || target.address[key] === "") {
      const v = e.address[key];
      if (v !== undefined && v !== "") target.address[key] = v;
    }
  }
  target.officers = unionCaseInsensitive(target.officers, e.officers);
  target.naics = union(target.naics, e.naics);
  target.contacts = unionCaseInsensitive(target.contacts, e.contacts);
  target.source_ids = union(target.source_ids, e.source_ids);
  target.evidence.push(...e.evidence);
  if (e.employees !== undefined) target.employees = Math.max(target.employees ?? 0, e.employees);
  if (e.lastSeen !== undefined && (target.lastSeen === undefined || e.lastSeen > target.lastSeen)) {
    target.lastSeen = e.lastSeen;
  }
}

// Aliases deduped by normalized form; the primary name never repeats as an alias.
function dedupeNames(primary: string, names: string[]): string[] {
  const seen = new Set([normalizeName(primary)]);
  const out: string[] = [];
  for (const n of names) {
    const key = normalizeName(n);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].filter(v => v !== "");
}

function unionCaseInsensitive(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...a, ...b]) {
    const key = v.toLowerCase().trim();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
