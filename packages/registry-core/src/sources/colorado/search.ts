import type { LocationQuery, EntityFilters, NormalizedEntity } from "../../types.js";
import { ENTITY_FIELDS, ENTITY_STATUS, ENTITY_DATASET_ID, SOCRATA_BASE } from "./entityFields.js";
import { TRADE_NAME_FIELDS, TRADE_NAME_DATASET_ID, TRADE_NAME_STATUS } from "./tradeNameFields.js";
import { normalizeEntity } from "./normalize.js";
import { buildSoqlUrl, fetchWithRetry, Limiter, type FetchRetryOptions } from "../../util/http.js";

const PAGE_SIZE = 2000;
const ZIP_CHUNK = 150;       // keep URLs well under GET limits
const ID_CHUNK = 100;
const MAX_KEYWORDS = 8;

// Keywords are interpolated into SoQL LIKE clauses. Strip anything that could
// break out of the string literal or act as a wildcard.
export function soqlSafeKeyword(kw: string): string {
  return kw.toUpperCase().replace(/[%_']/g, "").replace(/\s+/g, " ").trim();
}

function likeClause(field: string, keywords: string[]): string {
  const parts = keywords.map(kw => `upper(${field}) LIKE '%${kw}%'`);
  return `(${parts.join(" OR ")})`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchAllPages(
  baseWhere: string,
  datasetId: string,
  limiter: Limiter,
  httpOpts: FetchRetryOptions
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const url = buildSoqlUrl(`${SOCRATA_BASE}/${datasetId}.json`, {
      $where: baseWhere,
      $limit: String(PAGE_SIZE),
      $offset: String(offset),
    });
    const resp = await limiter.run(() => fetchWithRetry(url, httpOpts));
    const page = (await resp.json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    offset += PAGE_SIZE;
  }
}

// Server-side keyword search: only rows whose entity name (or trade-name
// description) matches a keyword ever leave the registry API. This is what
// keeps a metro-wide radius query at hundreds of rows instead of hundreds of
// thousands.
export async function* searchEntities(
  query: LocationQuery,
  keywords: string[],
  filters: EntityFilters = {},
  httpOpts: FetchRetryOptions = {}
): AsyncIterable<NormalizedEntity> {
  const safe = keywords.map(soqlSafeKeyword).filter(k => k.length >= 3).slice(0, MAX_KEYWORDS);
  if (safe.length === 0) return;
  const zips = query.zips ?? [];
  if (zips.length === 0) return;

  const limiter = new Limiter(4);
  const fetchedAt = new Date().toISOString();
  const status = filters.status ?? ENTITY_STATUS.goodStanding;
  const seen = new Set<string>();

  const dateParts: string[] = [];
  if (filters.formDateAfter !== undefined) {
    dateParts.push(`${ENTITY_FIELDS.formDate} >= '${filters.formDateAfter}'`);
  }
  if (filters.formDateBefore !== undefined) {
    dateParts.push(`${ENTITY_FIELDS.formDate} <= '${filters.formDateBefore}'`);
  }

  for (const zipChunk of chunk(zips, ZIP_CHUNK)) {
    const zipList = zipChunk.map(z => `'${z}'`).join(",");

    const entityWhere = [
      `${ENTITY_FIELDS.status}='${status}'`,
      `${ENTITY_FIELDS.zipCode} IN (${zipList})`,
      likeClause(ENTITY_FIELDS.name, safe),
      ...dateParts,
    ].join(" AND ");

    const tradeWhere = [
      `${TRADE_NAME_FIELDS.entityStatus}='${TRADE_NAME_STATUS.good}'`,
      `zipcode IN (${zipList})`,
      likeClause(TRADE_NAME_FIELDS.description, safe),
    ].join(" AND ");

    const [entityRows, tradeRows] = await Promise.all([
      fetchAllPages(entityWhere, ENTITY_DATASET_ID, limiter, httpOpts),
      fetchAllPages(tradeWhere, TRADE_NAME_DATASET_ID, limiter, httpOpts),
    ]);

    // Trade-name hits give us entity IDs; pull those entity records by ID
    // (they may not match on legal name — that's the point of trade names).
    const tradeEntityIds = [...new Set(
      tradeRows.map(r => String(r[TRADE_NAME_FIELDS.entityId] ?? "")).filter(Boolean)
    )].filter(id => !entityRows.some(r => String(r[ENTITY_FIELDS.id]) === id));

    const byIdRows: Record<string, unknown>[] = [];
    for (const idChunk of chunk(tradeEntityIds, ID_CHUNK)) {
      const idList = idChunk.map(id => `'${id}'`).join(",");
      const where = [
        `${ENTITY_FIELDS.id} IN (${idList})`,
        `${ENTITY_FIELDS.status}='${status}'`,
        ...dateParts,
      ].join(" AND ");
      byIdRows.push(...await fetchAllPages(where, ENTITY_DATASET_ID, limiter, httpOpts));
    }

    for (const row of [...entityRows, ...byIdRows]) {
      const id = String(row[ENTITY_FIELDS.id] ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      yield normalizeEntity(row, fetchedAt);
    }
  }
}
