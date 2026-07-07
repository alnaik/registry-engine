import type { TradeName } from "../../types.js";
import { TRADE_NAME_FIELDS, TRADE_NAME_DATASET_ID, TRADE_NAME_STATUS } from "./tradeNameFields.js";
import { normalizeTradeName } from "./normalize.js";
import { buildSoqlUrl, fetchWithRetry, type FetchRetryOptions } from "../../util/http.js";
import { SOCRATA_BASE } from "./entityFields.js";

export async function fetchTradeNamesForEntities(
  entityIds: string[],
  httpOpts: FetchRetryOptions = {}
): Promise<Map<string, TradeName[]>> {
  if (entityIds.length === 0) return new Map();

  const idList = entityIds.map(id => `'${id}'`).join(",");
  const url = buildSoqlUrl(`${SOCRATA_BASE}/${TRADE_NAME_DATASET_ID}.json`, {
    $where: `${TRADE_NAME_FIELDS.entityId} IN (${idList}) AND ${TRADE_NAME_FIELDS.entityStatus}='${TRADE_NAME_STATUS.good}'`,
    $limit: "10000",
  });

  const resp = await fetchWithRetry(url, httpOpts);
  const rows = (await resp.json()) as Record<string, unknown>[];

  const result = new Map<string, TradeName[]>();
  for (const row of rows) {
    const entityId = String(row[TRADE_NAME_FIELDS.entityId] ?? "");
    if (!entityId) continue;
    const existing = result.get(entityId) ?? [];
    existing.push(normalizeTradeName(row));
    result.set(entityId, existing);
  }
  return result;
}

export async function fetchNewTradeNames(
  since: string,
  zips: string[],
  httpOpts: FetchRetryOptions = {}
): Promise<Array<{ entityId: string; tradeName: TradeName }>> {
  const whereParts = [
    `${TRADE_NAME_FIELDS.entityStatus}='${TRADE_NAME_STATUS.good}'`,
    `${TRADE_NAME_FIELDS.dateAdded} >= '${since}'`,
  ];
  if (zips.length > 0) {
    // trade names dataset has zipcode field
    whereParts.push(`zipcode IN (${zips.map(z => `'${z}'`).join(",")})`);
  }

  const url = buildSoqlUrl(`${SOCRATA_BASE}/${TRADE_NAME_DATASET_ID}.json`, {
    $where: whereParts.join(" AND "),
    $limit: "10000",
    $order: `${TRADE_NAME_FIELDS.dateAdded} DESC`,
  });

  const resp = await fetchWithRetry(url, httpOpts);
  const rows = (await resp.json()) as Record<string, unknown>[];
  return rows.map(row => ({
    entityId: String(row[TRADE_NAME_FIELDS.entityId] ?? ""),
    tradeName: normalizeTradeName(row),
  }));
}
