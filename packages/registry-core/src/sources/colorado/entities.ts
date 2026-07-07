import type { LocationQuery, EntityFilters, NormalizedEntity } from "../../types.js";
import { ENTITY_FIELDS, ENTITY_STATUS, ENTITY_DATASET_ID, SOCRATA_BASE } from "./entityFields.js";
import { normalizeEntity } from "./normalize.js";
import { buildSoqlUrl, fetchWithRetry, Limiter, type FetchRetryOptions } from "../../util/http.js";

const PAGE_SIZE = 1000;
const FETCH_CONCURRENCY = 4;

export async function* fetchEntities(
  query: LocationQuery,
  filters: EntityFilters = {},
  httpOpts: FetchRetryOptions = {}
): AsyncIterable<NormalizedEntity> {
  const limiter = new Limiter(FETCH_CONCURRENCY);
  const fetchedAt = new Date().toISOString();
  const status = filters.status ?? ENTITY_STATUS.goodStanding;

  // Build base $where clause
  const whereParts: string[] = [`${ENTITY_FIELDS.status}='${status}'`];

  if (query.mode === "zip" && query.zips !== undefined && query.zips.length > 0) {
    const zipList = query.zips.map(z => `'${z}'`).join(",");
    whereParts.push(`${ENTITY_FIELDS.zipCode} IN (${zipList})`);
  } else if (query.mode === "radius") {
    // within_circle not available — convert radius to zip list via centroids
    // The caller should resolve radius -> zips before calling fetchEntities
    // If zips provided on a radius query, use them
    if (query.zips !== undefined && query.zips.length > 0) {
      const zipList = query.zips.map(z => `'${z}'`).join(",");
      whereParts.push(`${ENTITY_FIELDS.zipCode} IN (${zipList})`);
    }
  }

  if (filters.formDateAfter !== undefined) {
    whereParts.push(`${ENTITY_FIELDS.formDate} >= '${filters.formDateAfter}'`);
  }
  if (filters.formDateBefore !== undefined) {
    whereParts.push(`${ENTITY_FIELDS.formDate} <= '${filters.formDateBefore}'`);
  }

  const baseWhere = whereParts.join(" AND ");

  // Fetch first page to determine if there are more
  const firstUrl = buildSoqlUrl(`${SOCRATA_BASE}/${ENTITY_DATASET_ID}.json`, {
    $where: baseWhere,
    $limit: String(PAGE_SIZE),
    $offset: "0",
    $order: `${ENTITY_FIELDS.id} ASC`,
  });

  const firstResp = await limiter.run(() => fetchWithRetry(firstUrl, httpOpts));
  const firstPage = (await firstResp.json()) as Record<string, unknown>[];

  for (const row of firstPage) {
    yield normalizeEntity(row, fetchedAt);
  }

  if (firstPage.length < PAGE_SIZE) return;

  // Fetch remaining pages concurrently in batches
  let offset = PAGE_SIZE;
  while (true) {
    // Kick off FETCH_CONCURRENCY pages at once
    const pagePromises: Promise<Record<string, unknown>[]>[] = [];
    for (let i = 0; i < FETCH_CONCURRENCY; i++) {
      const url = buildSoqlUrl(`${SOCRATA_BASE}/${ENTITY_DATASET_ID}.json`, {
        $where: baseWhere,
        $limit: String(PAGE_SIZE),
        $offset: String(offset + i * PAGE_SIZE),
        $order: `${ENTITY_FIELDS.id} ASC`,
      });
      pagePromises.push(
        limiter.run(() => fetchWithRetry(url, httpOpts).then(r => r.json() as Promise<Record<string, unknown>[]>))
      );
    }

    const pages = await Promise.all(pagePromises);
    let totalRows = 0;
    for (const page of pages) {
      totalRows += page.length;
      for (const row of page) {
        yield normalizeEntity(row, fetchedAt);
      }
    }
    offset += FETCH_CONCURRENCY * PAGE_SIZE;
    if (totalRows < FETCH_CONCURRENCY * PAGE_SIZE) break;
  }
}
