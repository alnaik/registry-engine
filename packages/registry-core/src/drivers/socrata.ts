import type { Driver, SourceSpec, FetchRequest } from "../driver.js";
import type { Entity } from "../entity.js";
import { buildSoqlUrl, fetchWithRetry, Limiter, type FetchRetryOptions } from "../util/http.js";
import { rowToEntity, keywordEvidence, str } from "./mapRow.js";

const PAGE_SIZE = 1000;
const DEFAULT_LIMIT = 500;
const MAX_KEYWORDS = 8;
const ID_CHUNK = 100;
const CONCURRENCY = 4;

// Socrata quirks carried by the manifest entry. The optional tradeNames block
// wires a second dataset whose descriptions are keyword-searched and whose
// hits join back to entities by ID (a DBA can match when the legal name
// doesn't — that's the point of trade names).
interface TradeNameQuirks {
  datasetId: string;
  statusValue: string;
  fields: { entityId: string; description: string; status: string; city: string };
}

interface SocrataQuirks {
  datasetId: string;
  statusValue: string;
  tradeNames?: TradeNameQuirks | undefined;
}

// Keywords and cities are interpolated into SoQL LIKE clauses. Strip anything
// that could break out of the string literal or act as a wildcard.
export function soqlSafeLiteral(v: string): string {
  return v.toUpperCase().replace(/[%_']/g, "").replace(/\s+/g, " ").trim();
}

function likeClause(field: string, values: string[]): string {
  const parts = values.map(v => `upper(${field}) LIKE '%${v}%'`);
  return `(${parts.join(" OR ")})`;
}

export class SocrataDriver implements Driver {
  readonly kind = "socrata" as const;

  async fetch(source: SourceSpec, req: FetchRequest, opts: FetchRetryOptions = {}): Promise<Entity[]> {
    const quirks = readQuirks(source);
    const keywords = req.keywords.map(soqlSafeLiteral).filter(k => k.length >= 3).slice(0, MAX_KEYWORDS);
    // Existence registries are only ever keyword-searched: without keywords a
    // statewide query would stream the whole registry.
    if (keywords.length === 0) return [];
    const cities = req.cities.map(soqlSafeLiteral).filter(c => c.length > 0);
    const limit = req.limit ?? DEFAULT_LIMIT;
    const limiter = new Limiter(CONCURRENCY);

    const f = source.fields;
    const statusWhere = `${f["status"]}='${quirks.statusValue}'`;
    const cityWhere = (cityField: string) => (cities.length > 0 ? [likeClause(cityField, cities)] : []);

    // 1) Entities whose legal name matches a keyword.
    const entityWhere = [
      statusWhere,
      likeClause(f["name"]!, keywords),
      ...cityWhere(f["city"] ?? ""),
    ].join(" AND ");
    const nameRows = await this.pages(source, quirks.datasetId, entityWhere, limit, limiter, opts);

    // 2) Trade names whose description matches; pull their entities by ID.
    let tradeRows: Record<string, unknown>[] = [];
    const tn = quirks.tradeNames;
    if (tn !== undefined) {
      const tradeWhere = [
        `${tn.fields.status}='${tn.statusValue}'`,
        likeClause(tn.fields.description, keywords),
        ...cityWhere(tn.fields.city),
      ].join(" AND ");
      tradeRows = await this.pages(source, tn.datasetId, tradeWhere, limit, limiter, opts);
    }

    const idField = f["id"]!;
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of nameRows) byId.set(str(row[idField]), row);

    const missingIds = tn === undefined ? [] : [...new Set(
      tradeRows.map(r => str(r[tn.fields.entityId])).filter(id => id !== "" && !byId.has(id))
    )];
    for (const chunk of chunks(missingIds, ID_CHUNK)) {
      const where = [
        `${idField} IN (${chunk.map(id => `'${soqlSafeLiteral(id)}'`).join(",")})`,
        statusWhere,
      ].join(" AND ");
      for (const row of await this.pages(source, quirks.datasetId, where, limit, limiter, opts)) {
        byId.set(str(row[idField]), row);
      }
    }

    // 3) Hydrate ALL result entities with their trade names, so names[] can
    // merge against other planes even when the match came from the legal name.
    const tradeNamesByEntity = new Map<string, Record<string, unknown>[]>();
    if (tn !== undefined && byId.size > 0) {
      for (const chunk of chunks([...byId.keys()], ID_CHUNK)) {
        const where = [
          `${tn.fields.entityId} IN (${chunk.map(id => `'${soqlSafeLiteral(id)}'`).join(",")})`,
          `${tn.fields.status}='${tn.statusValue}'`,
        ].join(" AND ");
        for (const row of await this.pages(source, tn.datasetId, where, 10000, limiter, opts)) {
          const eid = str(row[tn.fields.entityId]);
          const list = tradeNamesByEntity.get(eid) ?? [];
          list.push(row);
          tradeNamesByEntity.set(eid, list);
        }
      }
    }

    const entities: Entity[] = [];
    for (const [id, row] of byId) {
      const entity = rowToEntity(source, row);
      entity.evidence.push(...keywordEvidence(source, f["name"]!, entity.name, keywords));
      // The trade dataset repeats descriptions across filings — dedupe per entity.
      const seenDescs = new Set<string>();
      for (const tr of tradeNamesByEntity.get(id) ?? []) {
        const desc = tn === undefined ? "" : str(tr[tn.fields.description]);
        if (desc === "" || seenDescs.has(desc.toUpperCase())) continue;
        seenDescs.add(desc.toUpperCase());
        if (!entity.names.includes(desc)) entity.names.push(desc);
        if (tn !== undefined) {
          entity.evidence.push(...keywordEvidence(source, tn.fields.description, desc, keywords));
        }
      }
      entities.push(entity);
      if (entities.length >= limit) break;
    }
    return entities;
  }

  private async pages(
    source: SourceSpec,
    datasetId: string,
    where: string,
    limit: number,
    limiter: Limiter,
    opts: FetchRetryOptions
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    while (rows.length < limit) {
      const url = buildSoqlUrl(`${source.endpoint}/${datasetId}.json`, {
        $where: where,
        $limit: String(PAGE_SIZE),
        $offset: String(offset),
      });
      const resp = await limiter.run(() => fetchWithRetry(url, opts));
      const page = (await resp.json()) as Record<string, unknown>[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return rows.slice(0, Math.max(limit, 0));
  }
}

function readQuirks(source: SourceSpec): SocrataQuirks {
  const q = source.quirks ?? {};
  const datasetId = q["datasetId"];
  const statusValue = q["statusValue"];
  if (typeof datasetId !== "string" || typeof statusValue !== "string") {
    throw new Error(`source "${source.id}": socrata driver needs quirks.datasetId and quirks.statusValue`);
  }
  let tradeNames: TradeNameQuirks | undefined;
  const tn = q["tradeNames"];
  if (tn !== undefined) {
    tradeNames = tn as TradeNameQuirks;
    if (typeof tradeNames.datasetId !== "string" || typeof tradeNames.statusValue !== "string" || typeof tradeNames.fields !== "object") {
      throw new Error(`source "${source.id}": quirks.tradeNames needs datasetId, statusValue, fields`);
    }
  }
  return { datasetId, statusValue, tradeNames };
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
