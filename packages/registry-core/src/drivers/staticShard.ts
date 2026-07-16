import type { Driver, SourceSpec, FetchRequest } from "../driver.js";
import type { Entity } from "../entity.js";
import { fetchWithRetry, type FetchRetryOptions } from "../util/http.js";
import { rowToEntity, keywordEvidence, str } from "./mapRow.js";

// Registries with no browser-reachable endpoint (no CORS, token bootstrap,
// bulk files) ship as pre-recorded shards: one JSON file per region at
//   <endpoint>/<region>.json           e.g. .../shards/paca/US-CO.json
// Shard shape: { source, region, generated, records: [...] } with records in
// the registry's own field names — the manifest field map does the rest.
// v3.0 records shards by hand; the pipeline that refreshes them comes later.

const DEFAULT_LIMIT = 500;

interface ShardFile {
  records: Record<string, unknown>[];
}

interface ShardQuirks {
  statusValue?: string | undefined;   // keep only records with fields.status == this
  namesField?: string | undefined;    // source field holding an alias array
  officersField?: string | undefined; // source field holding an officers array
  shardRegions?: string[] | undefined; // regions a shard file exists for
}

export class StaticShardDriver implements Driver {
  readonly kind = "static_shard" as const;

  async fetch(source: SourceSpec, req: FetchRequest, opts: FetchRetryOptions = {}): Promise<Entity[]> {
    const quirks = (source.quirks ?? {}) as ShardQuirks;
    if (quirks.shardRegions !== undefined && !quirks.shardRegions.includes(req.region)) {
      return [];
    }

    const resp = await fetchWithRetry(`${source.endpoint}/${req.region}.json`, opts);
    if (!resp.ok) throw new Error(`source "${source.id}": shard ${req.region}.json -> HTTP ${resp.status}`);
    const shard = (await resp.json()) as ShardFile;
    if (!Array.isArray(shard.records)) throw new Error(`source "${source.id}": shard has no records[]`);

    const statusField = source.fields["status"];
    const cityField = source.fields["city"];
    const cities = req.cities.map(c => c.toUpperCase());
    const limit = req.limit ?? DEFAULT_LIMIT;

    const out: Entity[] = [];
    for (const row of shard.records) {
      if (quirks.statusValue !== undefined && statusField !== undefined
        && str(row[statusField]) !== quirks.statusValue) continue;

      if (cities.length > 0 && cityField !== undefined) {
        const city = str(row[cityField]).toUpperCase();
        if (!cities.some(c => city.includes(c))) continue;
      }

      const entity = rowToEntity(source, row);
      entity.names = stringList(row, quirks.namesField).filter(n => n !== entity.name);
      entity.officers = [...entity.officers, ...stringList(row, quirks.officersField)];

      // The shard region + category coverage is the base evidence: being in
      // this registry at all is what qualifies the record.
      entity.evidence.push({
        source: source.id,
        field: "registry",
        value: source.name,
        note: entity.categories.length > 0 ? `licensed: ${entity.categories.join(", ")}` : "listed",
      });

      if (req.keywords.length > 0) {
        const nameHits = [entity.name, ...entity.names].flatMap(n =>
          keywordEvidence(source, source.fields["name"]!, n, req.keywords));
        // Keywords narrow within the category when they hit; a category-plane
        // record with no keyword hit still belongs to the category, so it
        // stays — ranking happens downstream, evidence records the difference.
        entity.evidence.push(...nameHits);
      }

      out.push(entity);
      if (out.length >= limit) break;
    }
    return out;
  }
}

function stringList(row: Record<string, unknown>, field: string | undefined): string[] {
  if (field === undefined) return [];
  const v = row[field];
  if (!Array.isArray(v)) return [];
  return v.map(str).filter(s => s !== "");
}
