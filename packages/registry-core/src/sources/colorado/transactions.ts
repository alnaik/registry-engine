import { TRANSACTION_FIELDS, STATUS_CHANGE_KEYWORDS, TRANSACTION_DATASET_ID } from "./transactionFields.js";
import { buildSoqlUrl, fetchWithRetry, type FetchRetryOptions } from "../../util/http.js";
import { SOCRATA_BASE } from "./entityFields.js";

export interface RawTransaction {
  entityId: string;
  transactionId: string;
  description: string;
  comment: string;
  receivedDate: string;
  effectiveDate: string;
  name: string;
}

export function isStatusChange(description: string): boolean {
  const lower = description.toLowerCase();
  return STATUS_CHANGE_KEYWORDS.some(kw => lower.includes(kw));
}

export async function fetchTransactionsForEntities(
  entityIds: string[],
  since: string,
  httpOpts: FetchRetryOptions = {}
): Promise<RawTransaction[]> {
  if (entityIds.length === 0) return [];

  const idList = entityIds.map(id => `'${id}'`).join(",");
  const url = buildSoqlUrl(`${SOCRATA_BASE}/${TRANSACTION_DATASET_ID}.json`, {
    $where: `${TRANSACTION_FIELDS.entityId} IN (${idList}) AND ${TRANSACTION_FIELDS.receivedDate} >= '${since}'`,
    $limit: "50000",
    $order: `${TRANSACTION_FIELDS.receivedDate} DESC`,
  });

  const resp = await fetchWithRetry(url, httpOpts);
  const rows = (await resp.json()) as Record<string, unknown>[];
  return rows.map(row => ({
    entityId: String(row[TRANSACTION_FIELDS.entityId] ?? ""),
    transactionId: String(row[TRANSACTION_FIELDS.transactionId] ?? ""),
    description: String(row[TRANSACTION_FIELDS.description] ?? ""),
    comment: String(row[TRANSACTION_FIELDS.comment] ?? ""),
    receivedDate: String(row[TRANSACTION_FIELDS.receivedDate] ?? ""),
    effectiveDate: String(row[TRANSACTION_FIELDS.effectiveDate] ?? ""),
    name: String(row[TRANSACTION_FIELDS.name] ?? ""),
  }));
}
