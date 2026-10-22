import type { SourceSpec, Plane, DriverKind } from "./driver.js";

const PLANES: readonly string[] = ["existence", "category", "contact"];
const DRIVERS: readonly string[] = ["socrata", "rest", "static_shard", "echo"];

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

// The manifest is declarative JSON shipped with the library; it is
// validated here so a bad config entry fails loudly at load, not as a
// mystery downstream.
export function loadManifest(raw: unknown): SourceSpec[] {
  if (!isRecord(raw) || !Array.isArray(raw["sources"])) {
    throw new ManifestError("manifest must be an object with a sources[] array");
  }
  const seen = new Set<string>();
  return raw["sources"].map((entry, i) => {
    const spec = validateSource(entry, i);
    if (seen.has(spec.id)) throw new ManifestError(`sources[${i}]: duplicate id "${spec.id}"`);
    seen.add(spec.id);
    return spec;
  });
}

function validateSource(entry: unknown, i: number): SourceSpec {
  const at = (msg: string) => new ManifestError(`sources[${i}]: ${msg}`);
  if (!isRecord(entry)) throw at("must be an object");

  const id = entry["id"];
  if (typeof id !== "string" || id.length === 0) throw at("id must be a non-empty string");

  const name = entry["name"];
  if (typeof name !== "string" || name.length === 0) throw at(`"${id}": name must be a non-empty string`);

  const plane = entry["plane"];
  if (typeof plane !== "string" || !PLANES.includes(plane)) {
    throw at(`"${id}": plane must be one of ${PLANES.join(" | ")}`);
  }

  const driver = entry["driver"];
  if (typeof driver !== "string" || !DRIVERS.includes(driver)) {
    throw at(`"${id}": driver must be one of ${DRIVERS.join(" | ")}`);
  }

  const coverage = entry["coverage"];
  if (!isRecord(coverage)) throw at(`"${id}": coverage must be an object`);
  const geo = stringArray(coverage["geo"]);
  if (geo === null || geo.length === 0) throw at(`"${id}": coverage.geo must be a non-empty string array`);
  if (coverage["categories"] !== undefined) {
    throw at(`"${id}": coverage.categories was replaced by coverage.naics (NAICS codes or prefixes; ["*"] = any)`);
  }
  const naics = stringArray(coverage["naics"]);
  if (naics === null || naics.length === 0 || naics.some(c => c !== "*" && !/^\d{2,6}$/.test(c))) {
    throw at(`"${id}": coverage.naics must be a non-empty array of NAICS codes (2-6 digits) or "*"`);
  }

  const endpoint = entry["endpoint"];
  if (typeof endpoint !== "string") throw at(`"${id}": endpoint must be a string`);
  if (endpoint.length === 0 && driver !== "static_shard") {
    throw at(`"${id}": endpoint may be empty only for static_shard sources`);
  }

  const fields = entry["fields"];
  if (!isRecord(fields) || Object.values(fields).some(v => typeof v !== "string")) {
    throw at(`"${id}": fields must map canonical field names to source field names (strings)`);
  }
  // Everything joins on normalized name and needs a stable record id.
  for (const required of ["id", "name"]) {
    if (typeof fields[required] !== "string" || fields[required] === "") {
      throw at(`"${id}": fields.${required} is required`);
    }
  }

  const contactFields = entry["contact_fields"] === undefined ? undefined : stringArray(entry["contact_fields"]);
  if (contactFields === null) throw at(`"${id}": contact_fields must be a string array`);

  const quirks = entry["quirks"];
  if (quirks !== undefined && !isRecord(quirks)) throw at(`"${id}": quirks must be an object`);

  return {
    id,
    name,
    plane: plane as Plane,
    driver: driver as DriverKind,
    coverage: { geo, naics },
    endpoint,
    fields: fields as Record<string, string>,
    contact_fields: contactFields,
    quirks: quirks as Record<string, unknown> | undefined,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.some(x => typeof x !== "string")) return null;
  return v as string[];
}
