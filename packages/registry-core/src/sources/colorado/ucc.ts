import { UCC_DEBTOR_FIELDS, UCC_SECURED_PARTY_FIELDS, UCC_DEBTOR_DATASET_ID, UCC_SECURED_PARTY_DATASET_ID } from "./uccFields.js";
import { buildSoqlUrl, fetchWithRetry, type FetchRetryOptions } from "../../util/http.js";
import { SOCRATA_BASE } from "./entityFields.js";

export interface UccRelationship {
  entityName: string;
  fileId: string;
  securedParties: string[];
}

function normalizeNameForMatch(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export async function fetchUccRelationships(
  entityNames: string[],
  httpOpts: FetchRetryOptions = {}
): Promise<UccRelationship[]> {
  if (entityNames.length === 0) return [];

  // Fetch debtors matching entity names (fuzzy: uppercase + strip punctuation)
  const normalized = entityNames.map(normalizeNameForMatch);
  // SoQL doesn't support case-insensitive search well; we fetch by org name equality on normalized
  // Colorado Socrata supports upper() — use it
  const nameConditions = normalized.map(n => `upper(${UCC_DEBTOR_FIELDS.orgName})='${n}'`).join(" OR ");
  const debtorUrl = buildSoqlUrl(`${SOCRATA_BASE}/${UCC_DEBTOR_DATASET_ID}.json`, {
    $where: `(${nameConditions}) AND ${UCC_DEBTOR_FIELDS.recordStatus}='active'`,
    $limit: "1000",
  });

  const debtorResp = await fetchWithRetry(debtorUrl, httpOpts);
  const debtors = (await debtorResp.json()) as Record<string, unknown>[];

  if (debtors.length === 0) return [];

  const fileIds = [...new Set(debtors.map(d => String(d[UCC_DEBTOR_FIELDS.fileId] ?? "")))].filter(Boolean);

  // Fetch secured parties for these file IDs
  const fileIdList = fileIds.map(id => `'${id}'`).join(",");
  const spUrl = buildSoqlUrl(`${SOCRATA_BASE}/${UCC_SECURED_PARTY_DATASET_ID}.json`, {
    $where: `${UCC_SECURED_PARTY_FIELDS.fileId} IN (${fileIdList}) AND ${UCC_SECURED_PARTY_FIELDS.recordStatus}='active'`,
    $limit: "5000",
  });

  const spResp = await fetchWithRetry(spUrl, httpOpts);
  const securedParties = (await spResp.json()) as Record<string, unknown>[];

  const spByFileId = new Map<string, string[]>();
  for (const sp of securedParties) {
    const fid = String(sp[UCC_SECURED_PARTY_FIELDS.fileId] ?? "");
    const name = String(sp[UCC_SECURED_PARTY_FIELDS.orgName] ?? sp[UCC_SECURED_PARTY_FIELDS.lastName] ?? "");
    if (!fid || !name) continue;
    const arr = spByFileId.get(fid) ?? [];
    arr.push(name);
    spByFileId.set(fid, arr);
  }

  return debtors.map(debtor => ({
    entityName: String(debtor[UCC_DEBTOR_FIELDS.orgName] ?? ""),
    fileId: String(debtor[UCC_DEBTOR_FIELDS.fileId] ?? ""),
    securedParties: spByFileId.get(String(debtor[UCC_DEBTOR_FIELDS.fileId] ?? "")) ?? [],
  }));
}
