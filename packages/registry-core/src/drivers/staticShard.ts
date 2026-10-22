import type { Driver, SourceSpec, FetchRequest } from "../driver.js";
import type { Entity } from "../entity.js";
import { naicsRelated } from "../naics.js";
import { fetchWithRetry, type FetchRetryOptions } from "../util/http.js";
import { rowToEntity, keywordEvidence, fieldEvidence, str } from "./mapRow.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Registries with no browser-reachable endpoint (no CORS, token bootstrap,
// bulk files) ship as pre-recorded shards: one JSON file per region at
//   <endpoint>/<region>.json           e.g. .../shards/paca/US-CO.json
// Shard shape: { source, region, generated, records: [...] } with records in
// the registry's own field names — the manifest field map does the rest.
// v3.0 records shards by hand; the pipeline that refreshes them comes later.
//
// An endpoint starting with "repo:" is a path relative to the repo root,
// read from disk ("repo:shards/paca"); http(s) endpoints are fetched.
// quirks.shardBy "naics2" splits big registries by NAICS sector:
//   <endpoint>/<region>/<NN>.json      one file per 2-digit sector
// Only the sectors the request's codes fall in are read; a missing sector
// file just means no records there.

const DEFAULT_LIMIT = 500;

interface ShardFile {
  records: Record<string, unknown>[];
}

interface ShardQuirks {
  statusValue?: string | undefined;   // keep only records with fields.status == this
  namesField?: string | undefined;    // source field holding an alias array
  officersField?: string | undefined; // source field holding an officers array
  shardRegions?: string[] | undefined; // regions a shard file exists for
  shardBy?: "naics2" | undefined;      // shard files per 2-digit NAICS sector
}

// staticShard.ts lives at packages/registry-core/src/drivers/.
const REPO_ROOT = new URL("../../../../", import.meta.url);

export class StaticShardDriver implements Driver {
  readonly kind = "static_shard" as const;

  async fetch(source: SourceSpec, req: FetchRequest, opts: FetchRetryOptions = {}): Promise<Entity[]> {
    const quirks = (source.quirks ?? {}) as ShardQuirks;
    if (quirks.shardRegions !== undefined && !quirks.shardRegions.includes(req.region)) {
      return [];
    }

    // Sector-sharded sources never stream a whole region: no codes, no read.
    let files = [`${req.region}.json`];
    if (quirks.shardBy === "naics2") {
      const sectors = [...new Set(req.naics.filter(c => c.length >= 2).map(c => c.slice(0, 2)))];
      if (sectors.length === 0) return [];
      files = sectors.map(n => `${req.region}/${n}.json`);
    }

    const statusField = source.fields["status"];
    const cityField = source.fields["city"];
    const cities = req.cities.map(c => c.toUpperCase());
    const limit = req.limit ?? DEFAULT_LIMIT;

    const codeFiltered = source.fields["naics"] !== undefined && req.naics.length > 0;

    const out: Entity[] = [];
    for (const file of files) {
      const shard = await readShard(source, file, quirks.shardBy !== undefined, opts);
      if (shard === null) continue;
      for (const row of shard.records) {
        if (quirks.statusValue !== undefined && statusField !== undefined
          && str(row[statusField]) !== quirks.statusValue) continue;

        if (cities.length > 0 && cityField !== undefined) {
          const city = str(row[cityField]).toUpperCase();
          if (!cities.some(c => city.includes(c))) continue;
        }

        const entity = rowToEntity(source, row);
        // Sources that carry an industry code per record are filtered by it
        // here; sources without one (PACA) belong to their codes wholesale.
        if (codeFiltered && !entity.naics.some(c => req.naics.some(q => naicsRelated(c, q)))) continue;
        entity.names = stringList(row, quirks.namesField).filter(n => n !== entity.name);
        entity.officers = [...entity.officers, ...stringList(row, quirks.officersField)];

        // The shard region + industry code is the base evidence: being in
        // this registry at all is what qualifies the record.
        entity.evidence.push({
          source: source.id,
          field: "registry",
          value: source.name,
          note: entity.naics.length > 0 ? `NAICS ${entity.naics.join(",")}` : "listed",
        });
        entity.evidence.push(...fieldEvidence(source, row));

        if (req.keywords.length > 0) {
          const nameHits = [entity.name, ...entity.names].flatMap(n =>
            keywordEvidence(source, source.fields["name"]!, n, req.keywords));
          // Keywords narrow within the category when they hit; a category-plane
          // record with no keyword hit still belongs to the category, so it
          // stays — ranking happens downstream, evidence records the difference.
          entity.evidence.push(...nameHits);
        }

        out.push(entity);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }
}

// Reads one shard file from disk (repo: endpoints) or over HTTP. With
// `optional`, a missing file is "no records here" (null), not an error.
async function readShard(
  source: SourceSpec,
  file: string,
  optional: boolean,
  opts: FetchRetryOptions
): Promise<ShardFile | null> {
  let shard: ShardFile;
  if (source.endpoint.startsWith("repo:")) {
    const path = fileURLToPath(new URL(`${source.endpoint.slice("repo:".length)}/${file}`, REPO_ROOT));
    try {
      shard = JSON.parse(await readFile(path, "utf8")) as ShardFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        if (optional) return null;
        throw new Error(`source "${source.id}": shard ${file} not found`);
      }
      throw err;
    }
  } else {
    const resp = await fetchWithRetry(`${source.endpoint}/${file}`, opts);
    if (optional && resp.status === 404) return null;
    if (!resp.ok) throw new Error(`source "${source.id}": shard ${file} -> HTTP ${resp.status}`);
    shard = (await resp.json()) as ShardFile;
  }
  if (!Array.isArray(shard.records)) throw new Error(`source "${source.id}": shard has no records[]`);
  return shard;
}

function stringList(row: Record<string, unknown>, field: string | undefined): string[] {
  if (field === undefined) return [];
  const v = row[field];
  if (!Array.isArray(v)) return [];
  return v.map(str).filter(s => s !== "");
}
