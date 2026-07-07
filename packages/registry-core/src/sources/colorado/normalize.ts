import type { NormalizedEntity, TradeName, SourceMeta } from "../../types.js";
import { ENTITY_FIELDS, ENTITY_DATASET_ID } from "./entityFields.js";
import { TRADE_NAME_FIELDS } from "./tradeNameFields.js";

function str(row: Record<string, unknown>, field: string): string {
  return String(row[field] ?? "");
}

export function normalizeEntity(
  row: Record<string, unknown>,
  fetchedAt: string
): NormalizedEntity {
  const source: SourceMeta = {
    provider: "colorado-sos",
    datasetId: ENTITY_DATASET_ID,
    fetchedAt,
  };

  const agent: NormalizedEntity["agent"] = {};
  if (row[ENTITY_FIELDS.agentFirstName] !== undefined) {
    agent.firstName = str(row, ENTITY_FIELDS.agentFirstName);
  }
  if (row[ENTITY_FIELDS.agentLastName] !== undefined) {
    agent.lastName = str(row, ENTITY_FIELDS.agentLastName);
  }
  if (row[ENTITY_FIELDS.agentOrgName] !== undefined) {
    agent.orgName = str(row, ENTITY_FIELDS.agentOrgName);
  }
  if (row[ENTITY_FIELDS.agentAddress1] !== undefined) {
    agent.address = str(row, ENTITY_FIELDS.agentAddress1);
  }
  if (row[ENTITY_FIELDS.agentCity] !== undefined) {
    agent.city = str(row, ENTITY_FIELDS.agentCity);
  }
  if (row[ENTITY_FIELDS.agentState] !== undefined) {
    agent.state = str(row, ENTITY_FIELDS.agentState);
  }
  if (row[ENTITY_FIELDS.agentZip] !== undefined) {
    agent.zip = str(row, ENTITY_FIELDS.agentZip);
  }

  return {
    id: str(row, ENTITY_FIELDS.id),
    name: str(row, ENTITY_FIELDS.name),
    status: str(row, ENTITY_FIELDS.status),
    type: str(row, ENTITY_FIELDS.type),
    formDate: str(row, ENTITY_FIELDS.formDate),
    zipCode: str(row, ENTITY_FIELDS.zipCode),
    city: str(row, ENTITY_FIELDS.city),
    state: str(row, ENTITY_FIELDS.state),
    address: str(row, ENTITY_FIELDS.address1),
    jurisdiction: str(row, ENTITY_FIELDS.jurisdiction),
    agent,
    tradeNames: [],
    source,
  };
}

export function normalizeTradeName(row: Record<string, unknown>): TradeName {
  return {
    id: str(row, TRADE_NAME_FIELDS.id),
    description: str(row, TRADE_NAME_FIELDS.description),
    dateAdded: str(row, TRADE_NAME_FIELDS.dateAdded),
    effectiveDate: str(row, TRADE_NAME_FIELDS.effectiveDate),
  };
}
