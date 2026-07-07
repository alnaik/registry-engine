import { ENTITY_FIELDS, ENTITY_DATASET_ID, SOCRATA_BASE } from "../sources/colorado/entityFields.js";
import { buildSoqlUrl, fetchWithRetry, type FetchRetryOptions } from "../util/http.js";
import type { VitalityRow } from "../types.js";

// Server-side aggregation with SoQL $select count(*)
export async function fetchVitality(
  zips: string[],
  keywords: string[],
  httpOpts: FetchRetryOptions = {}
): Promise<VitalityRow[]> {
  const now = new Date();
  const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
  const d365 = new Date(now); d365.setDate(d365.getDate() - 365);

  const rows: VitalityRow[] = [];

  for (const zip of zips) {
    for (const kw of keywords) {
      const f90 = await countEntities(zip, kw, d90.toISOString(), now.toISOString(), false, httpOpts);
      const dis90 = await countEntities(zip, kw, d90.toISOString(), now.toISOString(), true, httpOpts);
      const f365 = await countEntities(zip, kw, d365.toISOString(), now.toISOString(), false, httpOpts);
      const dis365 = await countEntities(zip, kw, d365.toISOString(), now.toISOString(), true, httpOpts);
      rows.push({
        zipCode: zip,
        keyword: kw,
        formations90d: f90,
        dissolutions90d: dis90,
        formations365d: f365,
        dissolutions365d: dis365,
      });
    }
  }
  return rows;
}

async function countEntities(
  zip: string,
  keyword: string,
  after: string,
  before: string,
  dissolved: boolean,
  httpOpts: FetchRetryOptions
): Promise<number> {
  const statusFilter = dissolved
    ? `${ENTITY_FIELDS.status} IN ('Voluntarily Dissolved','Administratively Dissolved','Delinquent')`
    : `${ENTITY_FIELDS.status}='Good Standing'`;

  const url = buildSoqlUrl(`${SOCRATA_BASE}/${ENTITY_DATASET_ID}.json`, {
    $select: "count(*)",
    $where: [
      `${ENTITY_FIELDS.zipCode}='${zip}'`,
      `upper(${ENTITY_FIELDS.name}) like '%${keyword.toUpperCase()}%'`,
      `${ENTITY_FIELDS.formDate} >= '${after}'`,
      `${ENTITY_FIELDS.formDate} <= '${before}'`,
      statusFilter,
    ].join(" AND "),
  });

  const resp = await fetchWithRetry(url, httpOpts);
  const data = (await resp.json()) as Array<Record<string, unknown>>;
  const first = data[0];
  return parseInt(String(first?.["count"] ?? "0"), 10);
}
